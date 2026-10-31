/**
 * Cola entre a saga e a fila: o resultado de `advanceSaga` vira a resposta do
 * handler. `retry`/`busy` voltam pela fila de espera sem gastar tentativa da
 * mensagem (quem conta tentativa é o passo); o resto é `ack`.
 *
 * Quem executa a saga é só o consumidor da fila (`handleSagaAdvance`) — o
 * request do checkout grava a saga e a primeira mensagem e vai embora. O
 * lease da saga deixa mensagem repetida rodar ao mesmo tempo sem estrago.
 */

import { and, eq } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { sagas, sagaSteps } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import * as queue from "@/queue";
import type { HandlerResult, QueueMessage } from "@/queue";
import { advanceSaga, applyStepReply, type AdvanceOptions, type AdvanceOutcome } from "./orchestrator";
import { PermanentError } from "@/shared/errors";
import { parseStepReply, SAGA_ADVANCE, SAGA_QUEUE } from "./messaging";
import { currentSagaVersion } from "./registry";

const logger = createLogger("saga:runner");

/** Folga mínima para reolhar uma saga ocupada. */
const BUSY_RECHECK_MS = 1_000;

export type StartSagaInput = {
  type: string;
  correlationId: string;
  payload: Record<string, unknown>;
};

/**
 * Cria a saga e grava a mensagem do primeiro avanço — chamar DENTRO da
 * transação de negócio. É o padrão outbox: pedido, saga e mensagem commitam
 * juntos, então não existe pedido órfão sem orquestração.
 */
export async function startSaga(executor: Executor, input: StartSagaInput): Promise<{ sagaId: string }> {
  const definitionVersion = currentSagaVersion(input.type);
  if (definitionVersion === undefined) throw new Error(`saga sem definição registrada: ${input.type}`);

  const [saga] = await executor
    .insert(sagas)
    .values({
      type: input.type,
      definitionVersion,
      correlationId: input.correlationId,
      payload: input.payload,
      context: {},
      status: "running",
    })
    .returning({ id: sagas.id });

  await enqueueAdvance(executor, saga.id);
  return { sagaId: saga.id };
}

/** Mensagem de avanço (opcionalmente adiada) — usada também pela reconciliação. */
export async function enqueueAdvance(executor: Executor, sagaId: string, delayMs = 0): Promise<void> {
  await queue.enqueue(executor, { type: SAGA_ADVANCE, queue: SAGA_QUEUE, payload: { sagaId }, delayMs });
}

/**
 * Avança a saga agora, no processo atual (testes e ferramentas de operação).
 * Se o passo pediu retry, deixa um avanço adiado na outbox: a mensagem
 * original pode já ter sido consumida. Duplicata não faz mal — o lease segura
 * a saga até a hora do retry.
 */
export async function runSagaInline(sagaId: string, options: AdvanceOptions = {}): Promise<AdvanceOutcome> {
  const outcome = await advanceSaga(sagaId, { workerId: "inline", ...options });
  if (outcome.status === "retry") {
    await enqueueAdvance(db, sagaId, outcome.runAt.getTime() - Date.now());
  }
  return outcome;
}

/**
 * Retoma uma saga `halted` depois que alguém corrigiu a causa: o passo que
 * parou volta para `pending` com as tentativas zeradas, a saga volta a
 * `running` e um avanço novo entra na outbox — tudo na mesma transação.
 */
export async function resumeHaltedSaga(sagaId: string, now: Date = new Date()): Promise<{ resumed: boolean }> {
  return db.transaction(async (tx) => {
    const [saga] = await tx
      .update(sagas)
      .set({ status: "running", lastError: null, lockedBy: null, leaseUntil: null, updatedAt: now })
      .where(and(eq(sagas.id, sagaId), eq(sagas.status, "halted")))
      .returning({ id: sagas.id });
    if (!saga) return { resumed: false };

    await tx
      .update(sagaSteps)
      .set({ status: "pending", attempts: 0, error: null, finishedAt: null })
      .where(and(eq(sagaSteps.sagaId, sagaId), eq(sagaSteps.status, "failed")));
    await enqueueAdvance(tx, sagaId);
    logger.info("saga retomada", { sagaId });
    return { resumed: true };
  });
}

/** Handler de `saga.advance`. */
export async function handleSagaAdvance(message: QueueMessage, options: AdvanceOptions = {}): Promise<HandlerResult> {
  const sagaId = typeof message.payload.sagaId === "string" ? message.payload.sagaId : null;
  if (!sagaId) throw new PermanentError("invalid_message", "saga.advance sem sagaId no payload");
  return toHandlerResult(await advanceSaga(sagaId, options));
}

/**
 * Handler de `saga.reply`: a resposta de um passo remoto. Aplica (uma vez só)
 * e avança a saga. Se outro executor estiver com a saga, a resposta volta para
 * espera em vez de se perder — ele pode já ter olhado o passo antes de a
 * resposta chegar e ido embora com `waiting`. Reaplicar é no-op.
 */
export async function handleSagaReply(message: QueueMessage, options: AdvanceOptions = {}): Promise<HandlerResult> {
  const reply = parseStepReply(message.payload);
  if (!reply) throw new PermanentError("invalid_message", "resposta de passo remoto inválida");

  const applied = await applyStepReply(reply);
  logger.debug("resposta de passo remoto", { sagaId: reply.sagaId, step: reply.step, phase: reply.phase, applied });
  return toHandlerResult(await advanceSaga(reply.sagaId, options));
}

function toHandlerResult(outcome: AdvanceOutcome): HandlerResult {
  const now = Date.now();
  switch (outcome.status) {
    case "retry":
      return { retryInMs: Math.max(0, outcome.runAt.getTime() - now), countAttempt: false };
    case "busy":
      return { retryInMs: Math.max(BUSY_RECHECK_MS, outcome.retryAt.getTime() - now), countAttempt: false };
    case "waiting":
    case "halted":
    case "completed":
    case "compensated":
    case "failed":
    case "settled":
    case "not-found":
      return;
  }
}
