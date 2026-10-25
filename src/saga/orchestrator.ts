/**
 * Orquestrador de SAGA.
 *
 * Responsabilidade única: avançar UMA saga do ponto em que ela parou, um
 * passo atômico por vez, e compensar em ordem reversa quando algo falha.
 * Ele não sabe o que os passos fazem (isso é `src/saga/definitions/*`) nem
 * como a fila funciona (isso é `src/saga/runner.ts` + `src/queue`).
 *
 * Invariantes:
 * 1. **Um executor por vez**: a saga tem um *lease* (`locked_by`/`lease_until`).
 *    Quem não pega o lease recebe `busy` (com a hora em que ele vence) e vai
 *    embora. Lease vencido é liberado pela reconciliação, então worker morto
 *    não trava o fluxo. Em retry com backoff a saga SEGURA o lease até a hora
 *    do retry: mensagem duplicada que chegue antes não roda o passo cedo.
 * 2. **Passo = transação**: `invoke()` e a gravação do log do passo
 *    (`saga_steps`) commitam juntos. Se o passo falha, nada dele fica.
 * 3. **Idempotência**: passo com log `completed` nunca roda de novo — é assim
 *    que uma retomada (retry, crash, reconciliação) não duplica efeito.
 * 4. **Tentativa contabilizada antes de executar**: um crash no meio do passo
 *    conta a tentativa, então não existe retry infinito.
 * 5. **Passo remoto estaciona**: grava `waiting` + comando na mesma transação,
 *    solta o lease e devolve `waiting`. A resposta (`applyStepReply`) é
 *    aplicada uma vez só; o próximo avanço segue de onde parou. Enquanto houver
 *    passo `waiting`, ninguém avança nem compensa por cima.
 */

import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, type Transaction } from "@/db";
import { sagaSteps, sagas } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { nextRunAt, type BackoffOptions } from "@/queue/backoff";
import { customerFacingMessage, errorCode, errorMessage, isRetryable } from "./errors";
import { dispatchStepRequest, type StepReply } from "./messaging";
import { getSagaDefinition } from "./registry";
import {
  DEFAULT_MAX_ATTEMPTS_PER_STEP,
  isRemoteStep,
  type SagaDefinition,
  type SagaStep,
  type StepContext,
} from "./types";

const logger = createLogger("saga");

export type SagaRow = typeof sagas.$inferSelect;
export type SagaStepRow = typeof sagaSteps.$inferSelect;

export type AdvanceOutcome =
  | { status: "completed" }
  | { status: "compensated"; code: string; reason: string }
  | { status: "failed"; reason: string }
  | { status: "retry"; step: string; runAt: Date; reason: string }
  /** Passo remoto aguardando resposta: nada a fazer até ela chegar. */
  | { status: "waiting"; step: string }
  /** Outro executor (ou o backoff) segura a saga até `retryAt`. */
  | { status: "busy"; retryAt: Date }
  | { status: "settled"; sagaStatus: SagaRow["status"] }
  | { status: "not-found" };

export type AdvanceOptions = {
  /** Identificação de quem está executando (worker id ou "inline"). */
  workerId?: string;
  leaseMs?: number;
  now?: Date;
  backoff?: BackoffOptions;
};

export const DEFAULT_SAGA_LEASE_MS = 30_000;
/** Quem "segura" a saga durante o backoff de um retry. */
const BACKOFF_HOLDER = "backoff";

const TERMINAL_STATUSES = ["completed", "compensated", "failed"] as const;

type Context = Record<string, unknown>;

export async function advanceSaga(sagaId: string, options: AdvanceOptions = {}): Promise<AdvanceOutcome> {
  const workerId = options.workerId ?? "inline";
  const now = options.now ?? new Date();
  const leaseUntil = new Date(now.getTime() + (options.leaseMs ?? DEFAULT_SAGA_LEASE_MS));

  // --- 1. lease -----------------------------------------------------------
  const leased = await db
    .update(sagas)
    .set({ lockedBy: workerId, leaseUntil, updatedAt: now })
    .where(
      and(
        eq(sagas.id, sagaId),
        inArray(sagas.status, ["running", "compensating"]),
        or(isNull(sagas.leaseUntil), lt(sagas.leaseUntil, now)),
      ),
    )
    .returning();

  const saga = leased[0];
  if (!saga) {
    const existing = await db.query.sagas.findFirst({ where: eq(sagas.id, sagaId) });
    if (!existing) return { status: "not-found" };
    if ((TERMINAL_STATUSES as readonly string[]).includes(existing.status)) {
      return { status: "settled", sagaStatus: existing.status };
    }
    // Backoff: a hora do retry é exata. Outro executor trabalhando: o lease é
    // só um teto (ele costuma soltar bem antes) — reolha logo.
    const retryAt = existing.lockedBy === BACKOFF_HOLDER && existing.leaseUntil ? existing.leaseUntil : now;
    return { status: "busy", retryAt };
  }

  // --- 2. definição + payload --------------------------------------------
  const definition = getSagaDefinition(saga.type);
  if (!definition) {
    await markFailed(saga.id, `Saga desconhecida: ${saga.type}`, now);
    return { status: "failed", reason: `Saga desconhecida: ${saga.type}` };
  }

  let payload: never;
  try {
    payload = definition.parsePayload(saga.payload) as never;
  } catch (error) {
    const reason = errorMessage(error);
    await markFailed(saga.id, `Payload inválido: ${reason}`, now);
    return { status: "failed", reason };
  }

  try {
    return await execute(saga, definition, payload, { ...options, workerId, now });
  } catch (error) {
    // Falha fora do fluxo previsto (bug, banco fora): solta o lease para não
    // travar a saga e deixa o retry da fila cuidar.
    await releaseLease(saga.id, now);
    logger.error("falha inesperada ao avançar saga", {
      sagaId: saga.id,
      error: errorMessage(error),
    });
    throw error;
  }
}

async function execute(
  saga: SagaRow,
  definition: SagaDefinition<never>,
  payload: never,
  options: AdvanceOptions & { workerId: string; now: Date },
): Promise<AdvanceOutcome> {
  const { now } = options;
  const maxAttempts = definition.maxAttemptsPerStep ?? DEFAULT_MAX_ATTEMPTS_PER_STEP;
  const steps = definition.steps;

  let context: Context = (saga.context ?? {}) as Context;
  let currentStep = saga.currentStep;
  let stepRows = await loadSteps(saga.id);

  const makeCtx = (attempt: number): StepContext<never> => ({
    sagaId: saga.id,
    correlationId: saga.correlationId,
    payload,
    context,
    attempt,
  });

  // Falha definitiva de um passo (local ou remoto): marca e desfaz o que já foi aplicado.
  const beginCompensation = async (code: string, message: string): Promise<AdvanceOutcome> => {
    const reason = customerFacingMessage(code);
    await db.transaction(async (tx) => {
      await writeSaga(tx, saga.id, { status: "compensating", lastError: `${code}: ${message}`, updatedAt: now });
    });
    return compensate({ ...saga, status: "compensating" }, definition, payload, {
      ...options,
      reason,
      code,
      context,
      stepRows: await loadSteps(saga.id),
      maxAttempts,
    });
  };

  // Já estava compensando (retomada de uma compensação que falhou antes).
  if (saga.status === "compensating") {
    return compensate(saga, definition, payload, {
      ...options,
      reason: saga.lastError ?? "Compensação retomada.",
      code: "resumed",
      context,
      stepRows,
      maxAttempts,
    });
  }

  // --- caminho feliz ------------------------------------------------------
  while (currentStep < steps.length) {
    const step = steps[currentStep];
    const existing = stepRows.find((row) => row.name === step.name);

    // Passo já aplicado numa execução anterior: só reaproveita a saída.
    if (existing?.status === "completed") {
      context = mergeOutput(context, existing.output);
      currentStep += 1;
      await persistProgress(saga.id, currentStep, context, now);
      continue;
    }

    const attempt = (existing?.attempts ?? 0) + 1;
    const ctx = makeCtx(attempt);

    if (step.skip?.(ctx)) {
      await db.transaction(async (tx) => {
        await upsertStep(tx, saga.id, step, currentStep, attempt, now);
        await finishStep(tx, saga.id, step.name, "completed", { skipped: true }, now);
        currentStep += 1;
        await writeSaga(tx, saga.id, { currentStep, context, updatedAt: now });
      });
      stepRows = await loadSteps(saga.id);
      continue;
    }

    if (isRemoteStep(step)) {
      if (existing?.status === "waiting") {
        await releaseLease(saga.id, now);
        return { status: "waiting", step: step.name };
      }

      if (existing?.status === "failed") {
        const code = outputCode(existing.output);
        logger.warn("passo remoto falhou definitivamente, compensando", {
          sagaId: saga.id,
          step: step.name,
          code,
        });
        return beginCompensation(code, existing.error ?? code);
      }

      // Outbox: o passo vira `waiting` e o comando entra na fila na mesma
      // transação — ou os dois existem, ou nenhum.
      await db.transaction(async (tx) => {
        await upsertStep(tx, saga.id, step, currentStep, attempt, now);
        await setStepStatus(tx, saga.id, step.name, "waiting");
        await dispatchStepRequest(tx, {
          sagaId: saga.id,
          step: step.name,
          phase: "invoke",
          request: step.request(ctx),
          maxAttempts,
        });
        await writeSaga(tx, saga.id, { updatedAt: now });
      });
      await releaseLease(saga.id, now);
      logger.debug("passo remoto enviado, aguardando resposta", { sagaId: saga.id, step: step.name });
      return { status: "waiting", step: step.name };
    }

    // Tentativa é registrada ANTES de executar (invariante 4).
    await db.transaction(async (tx) => {
      await upsertStep(tx, saga.id, step, currentStep, attempt, now);
    });

    try {
      const nextContext = await db.transaction(async (tx) => {
        const output = await step.invoke(ctx, tx);
        const merged = mergeOutput(context, output);
        await finishStep(tx, saga.id, step.name, "completed", output ?? null, new Date());
        await writeSaga(tx, saga.id, { currentStep: currentStep + 1, context: merged, updatedAt: new Date() });
        return merged;
      });

      context = nextContext;
      currentStep += 1;
      stepRows = await loadSteps(saga.id);
      logger.debug("passo concluído", { sagaId: saga.id, step: step.name, attempt });
    } catch (error) {
      const code = errorCode(error);
      const message = errorMessage(error);
      const canRetry = isRetryable(error) && attempt < maxAttempts;

      await db.transaction(async (tx) => {
        await finishStep(tx, saga.id, step.name, canRetry ? "pending" : "failed", null, new Date(), message);
      });

      if (canRetry) {
        const runAt = nextRunAt(attempt, now, options.backoff);
        await holdUntil(saga.id, runAt, message);
        logger.warn("passo falhou, vai tentar de novo", {
          sagaId: saga.id,
          step: step.name,
          attempt,
          code,
          runAt: runAt.toISOString(),
        });
        return { status: "retry", step: step.name, runAt, reason: message };
      }

      logger.warn("passo falhou definitivamente, compensando", {
        sagaId: saga.id,
        step: step.name,
        attempt,
        code,
      });

      return beginCompensation(code, message);
    }
  }

  await db.transaction(async (tx) => {
    await writeSaga(tx, saga.id, {
      status: "completed",
      currentStep,
      context,
      lockedBy: null,
      leaseUntil: null,
      lastError: null,
      finishedAt: now,
      updatedAt: now,
    });
  });

  logger.info("saga concluída", { sagaId: saga.id, type: saga.type, correlationId: saga.correlationId });
  return { status: "completed" };
}

async function compensate(
  saga: SagaRow,
  definition: SagaDefinition<never>,
  payload: never,
  options: AdvanceOptions & {
    workerId: string;
    now: Date;
    reason: string;
    code: string;
    context: Context;
    stepRows: SagaStepRow[];
    maxAttempts: number;
  },
): Promise<AdvanceOutcome> {
  const { now, reason, code, context, maxAttempts } = options;
  const byName = new Map(definition.steps.map((step) => [step.name, step] as const));

  // Desfazer remoto em andamento: não compensa o passo anterior por cima.
  const waitingRow = options.stepRows.find((row) => row.status === "waiting");
  if (waitingRow) {
    await releaseLease(saga.id, now);
    return { status: "waiting", step: waitingRow.name };
  }

  const applied = [...options.stepRows]
    .filter((row) => row.status === "completed")
    .sort((a, b) => b.position - a.position);

  for (const row of applied) {
    const step = byName.get(row.name);
    const attempt = row.attempts + 1;
    const ctx: StepContext<never> = {
      sagaId: saga.id,
      correlationId: saga.correlationId,
      payload,
      context,
      attempt,
    };

    if (step && isRemoteStep(step) && step.compensateRequest && !isSkipped(row.output)) {
      const request = step.compensateRequest(ctx);
      await db.transaction(async (tx) => {
        await setStepStatus(tx, saga.id, row.name, "waiting");
        await dispatchStepRequest(tx, { sagaId: saga.id, step: row.name, phase: "compensate", request, maxAttempts });
        await writeSaga(tx, saga.id, { updatedAt: now });
      });
      await releaseLease(saga.id, now);
      logger.debug("compensação remota enviada, aguardando resposta", { sagaId: saga.id, step: row.name });
      return { status: "waiting", step: row.name };
    }

    try {
      await db.transaction(async (tx) => {
        const skipped = isSkipped(row.output);
        if (step && !isRemoteStep(step) && step.compensate && !skipped) {
          await step.compensate(ctx, tx);
        }
        await finishStep(tx, saga.id, row.name, "compensated", row.output, new Date(), null, attempt);
      });
      logger.debug("passo compensado", { sagaId: saga.id, step: row.name });
    } catch (error) {
      const message = errorMessage(error);

      if (attempt < maxAttempts) {
        const runAt = nextRunAt(attempt, now, options.backoff);
        await db.transaction(async (tx) => {
          await bumpStepAttempts(tx, saga.id, row.name, attempt, message);
        });
        await holdUntil(saga.id, runAt, message);
        logger.warn("compensação falhou, vai tentar de novo", {
          sagaId: saga.id,
          step: row.name,
          attempt,
          runAt: runAt.toISOString(),
        });
        return { status: "retry", step: row.name, runAt, reason: message };
      }

      const fatal = `compensação de ${row.name} falhou: ${message}`;
      await markFailed(saga.id, fatal, now);
      logger.error("saga precisa de intervenção manual", { sagaId: saga.id, step: row.name, error: message });
      return { status: "failed", reason: fatal };
    }
  }

  await db.transaction(async (tx) => {
    if (definition.onCompensated) {
      await definition.onCompensated(
        { sagaId: saga.id, correlationId: saga.correlationId, payload, context, attempt: 1 },
        tx,
        reason,
      );
    }
    await writeSaga(tx, saga.id, {
      status: "compensated",
      lockedBy: null,
      leaseUntil: null,
      lastError: saga.lastError ?? `${code}: ${reason}`,
      finishedAt: now,
      updatedAt: now,
    });
  });

  logger.info("saga compensada", { sagaId: saga.id, code, reason });
  return { status: "compensated", code, reason };
}

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------

async function loadSteps(sagaId: string): Promise<SagaStepRow[]> {
  return db.query.sagaSteps.findMany({
    where: eq(sagaSteps.sagaId, sagaId),
    orderBy: [asc(sagaSteps.position)],
  });
}

async function upsertStep(
  tx: Transaction,
  sagaId: string,
  step: SagaStep<never>,
  position: number,
  attempt: number,
  now: Date,
): Promise<void> {
  await tx
    .insert(sagaSteps)
    .values({ sagaId, name: step.name, position, status: "pending", attempts: attempt, startedAt: now })
    .onConflictDoUpdate({
      target: [sagaSteps.sagaId, sagaSteps.name],
      set: { status: "pending", attempts: attempt, error: null, finishedAt: null },
    });
}

async function finishStep(
  tx: Transaction,
  sagaId: string,
  name: string,
  status: SagaStepRow["status"],
  output: unknown,
  at: Date,
  error: string | null = null,
  attempts?: number,
): Promise<void> {
  await tx
    .update(sagaSteps)
    .set({
      status,
      output: output === undefined ? null : output,
      error,
      finishedAt: at,
      ...(attempts == null ? {} : { attempts }),
    })
    .where(and(eq(sagaSteps.sagaId, sagaId), eq(sagaSteps.name, name)));
}

async function setStepStatus(
  tx: Transaction,
  sagaId: string,
  name: string,
  status: SagaStepRow["status"],
): Promise<void> {
  await tx
    .update(sagaSteps)
    .set({ status, error: null })
    .where(and(eq(sagaSteps.sagaId, sagaId), eq(sagaSteps.name, name)));
}

async function bumpStepAttempts(
  tx: Transaction,
  sagaId: string,
  name: string,
  attempts: number,
  error: string,
): Promise<void> {
  await tx
    .update(sagaSteps)
    .set({ attempts, error })
    .where(and(eq(sagaSteps.sagaId, sagaId), eq(sagaSteps.name, name)));
}

async function writeSaga(
  tx: Transaction,
  sagaId: string,
  values: Partial<typeof sagas.$inferInsert>,
): Promise<void> {
  await tx.update(sagas).set(values).where(eq(sagas.id, sagaId));
}

async function persistProgress(sagaId: string, currentStep: number, context: Context, now: Date): Promise<void> {
  await db.update(sagas).set({ currentStep, context, updatedAt: now }).where(eq(sagas.id, sagaId));
}

async function releaseLease(sagaId: string, now: Date, lastError?: string): Promise<void> {
  await db
    .update(sagas)
    .set({ lockedBy: null, leaseUntil: null, updatedAt: now, ...(lastError ? { lastError } : {}) })
    .where(eq(sagas.id, sagaId));
}

/** Backoff: a saga fica "ocupada" até a hora do retry (ver invariante 1). */
async function holdUntil(sagaId: string, runAt: Date, lastError: string): Promise<void> {
  await db
    .update(sagas)
    .set({ lockedBy: BACKOFF_HOLDER, leaseUntil: runAt, lastError, updatedAt: new Date() })
    .where(eq(sagas.id, sagaId));
}

async function markFailed(sagaId: string, reason: string, now: Date): Promise<void> {
  await db
    .update(sagas)
    .set({ status: "failed", lastError: reason, lockedBy: null, leaseUntil: null, finishedAt: now, updatedAt: now })
    .where(eq(sagas.id, sagaId));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mergeOutput(context: Context, output: unknown): Context {
  if (!output || typeof output !== "object" || Array.isArray(output)) return context;
  return { ...context, ...(output as Context) };
}

/** Código de erro que a resposta de um passo remoto deixou no log do passo. */
function outputCode(output: unknown): string {
  const code = output && typeof output === "object" ? (output as Record<string, unknown>).code : null;
  return typeof code === "string" ? code : "remote_failure";
}

function isSkipped(output: unknown): boolean {
  return Boolean(output && typeof output === "object" && (output as Record<string, unknown>).skipped === true);
}

/**
 * Sagas em execução sem ninguém nelas (lease livre ou vencido) e sem progresso
 * há `idleMs` — candidatas a perder a mensagem de avanço (DLQ, broker que
 * perdeu a fila). Usado na reconciliação. Saga com passo `waiting` fica de
 * fora: ela não está parada, está esperando uma resposta que já está garantida
 * pela outbox dos dois lados.
 */
export async function findStaleSagas(now: Date, limit = 50, idleMs = 60_000): Promise<SagaRow[]> {
  return db.query.sagas.findMany({
    where: and(
      inArray(sagas.status, ["running", "compensating"]),
      or(isNull(sagas.leaseUntil), lt(sagas.leaseUntil, now)),
      lt(sagas.updatedAt, new Date(now.getTime() - idleMs)),
      // SQL cru de propósito: na API relacional (db.query) o Drizzle reescreve
      // colunas de OUTRA tabela com o apelido da principal ("sagas"."saga_id").
      sql`not exists (select 1 from saga_steps st where st.saga_id = ${sagas.id} and st.status = 'waiting')`,
    ),
    orderBy: [asc(sagas.createdAt)],
    limit,
  });
}

/** Libera leases vencidos (worker morto). Retorna quantas sagas foram liberadas. */
export async function releaseExpiredLeases(now: Date): Promise<number> {
  const rows = await db
    .update(sagas)
    .set({ lockedBy: null, leaseUntil: null, updatedAt: now })
    .where(
      and(
        inArray(sagas.status, ["running", "compensating"]),
        sql`${sagas.leaseUntil} is not null`,
        lt(sagas.leaseUntil, now),
      ),
    )
    .returning({ id: sagas.id });
  return rows.length;
}

export async function getSagaById(sagaId: string): Promise<SagaRow | undefined> {
  return db.query.sagas.findFirst({ where: eq(sagas.id, sagaId) });
}

export async function getSagaWithSteps(sagaId: string) {
  return db.query.sagas.findFirst({
    where: eq(sagas.id, sagaId),
    with: { steps: { orderBy: [asc(sagaSteps.position)] } },
  });
}

export async function getSagaByCorrelationId(correlationId: string) {
  return db.query.sagas.findFirst({
    where: eq(sagas.correlationId, correlationId),
    orderBy: [desc(sagas.createdAt)],
    with: { steps: { orderBy: [asc(sagaSteps.position)] } },
  });
}

/**
 * Aplica a resposta de um passo remoto ao log do passo. Idempotente: só mexe
 * se o passo ainda está `waiting` naquela fase — resposta repetida (entrega
 * "pelo menos uma vez") ou atrasada vira no-op. Não avança a saga; quem chama
 * avança depois (ver runner).
 */
export async function applyStepReply(reply: StepReply, options: { now?: Date } = {}): Promise<boolean> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(sagaSteps)
      .where(and(eq(sagaSteps.sagaId, reply.sagaId), eq(sagaSteps.name, reply.step)))
      .for("update");
    if (!row || row.status !== "waiting") return false;

    const { result } = reply;
    // Tentativas que o outro serviço gastou (o retry agora é dele).
    const attempts = reply.phase === "invoke" ? result.attempts : row.attempts + result.attempts;

    if (reply.phase === "invoke") {
      if (result.ok) {
        await finishStep(tx, reply.sagaId, reply.step, "completed", result.output, now, null, attempts);
      } else {
        await finishStep(tx, reply.sagaId, reply.step, "failed", { code: result.code }, now, result.message, attempts);
      }
      return true;
    }

    if (result.ok) {
      await finishStep(tx, reply.sagaId, reply.step, "compensated", row.output, now, null, attempts);
      return true;
    }

    // Desfazer remoto falhou de vez: algo aplicado não pôde ser desfeito.
    const fatal = `compensação de ${reply.step} falhou: ${result.message}`;
    await finishStep(tx, reply.sagaId, reply.step, "failed", row.output, now, result.message, attempts);
    await writeSaga(tx, reply.sagaId, {
      status: "failed",
      lastError: fatal,
      lockedBy: null,
      leaseUntil: null,
      finishedAt: now,
      updatedAt: now,
    });
    logger.error("saga precisa de intervenção manual", { sagaId: reply.sagaId, step: reply.step, error: result.message });
    return true;
  });
}
