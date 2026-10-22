/**
 * Cola entre a saga e a fila.
 *
 * O orquestrador (`advanceSaga`) não conhece a fila; aqui a gente traduz o
 * resultado dele em efeito na fila:
 *
 *   retry   → reagenda o MESMO job com backoff
 *   busy    → devolve o job sem gastar tentativa (outro executor está nela)
 *   waiting → fecha o job: passo remoto, quem acorda a saga é a resposta
 *   final   → fecha o job (e qualquer outro job ativo da mesma saga)
 *
 * São dois caminhos pro mesmo código:
 * - **inline** (`runSagaInline`): o próprio request do checkout avança a saga,
 *   então o cliente já cai na página do pedido com o resultado final;
 * - **worker** (`handleSagaAdvanceJob`): processa o job da fila. É o caminho
 *   durável — se o processo do Next morrer no meio, o worker termina.
 *
 * O lease da saga garante que os dois nunca avancem a mesma saga ao mesmo
 * tempo, então rodar os dois é seguro.
 */

import type { Executor } from "@/db";
import { sagas } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import * as queue from "@/queue";
import type { ClaimedJob } from "@/queue";
import { advanceSaga, applyStepReply, type AdvanceOptions, type AdvanceOutcome } from "./orchestrator";
import { errorMessage } from "./errors";
import { parseStepReply } from "./messaging";

const logger = createLogger("saga:runner");

export const SAGA_ADVANCE_JOB = "saga.advance";
export const SAGA_RECONCILE_JOB = "saga.reconcile";

export function advanceDedupeKey(sagaId: string): string {
  return `saga:${sagaId}:advance`;
}

export type StartSagaInput = {
  type: string;
  correlationId: string;
  payload: Record<string, unknown>;
  queue?: string;
};

/**
 * Cria a saga e enfileira o primeiro avanço — chamar DENTRO da transação de
 * negócio. É o padrão outbox: pedido, saga e job commitam juntos, então não
 * existe pedido órfão sem orquestração.
 */
export async function startSaga(executor: Executor, input: StartSagaInput): Promise<{ sagaId: string }> {
  const [saga] = await executor
    .insert(sagas)
    .values({
      type: input.type,
      correlationId: input.correlationId,
      payload: input.payload,
      context: {},
      status: "running",
    })
    .returning({ id: sagas.id });

  await queue.enqueue(executor, {
    type: SAGA_ADVANCE_JOB,
    payload: { sagaId: saga.id },
    queue: input.queue,
    dedupeKey: advanceDedupeKey(saga.id),
  });

  return { sagaId: saga.id };
}

/** Avança a saga agora, no processo atual, e sincroniza a fila. */
export async function runSagaInline(sagaId: string, options: AdvanceOptions = {}): Promise<AdvanceOutcome> {
  const outcome = await advanceSaga(sagaId, { workerId: "inline", ...options });
  await syncQueue(sagaId, outcome, { jobId: null });
  return outcome;
}

/**
 * Versão "nunca quebra o request": usada pelo checkout. Se qualquer coisa
 * explodir aqui, o pedido já está salvo e o job na fila — o worker assume.
 */
export async function tryRunSagaInline(sagaId: string, options: AdvanceOptions = {}): Promise<AdvanceOutcome | null> {
  try {
    return await runSagaInline(sagaId, options);
  } catch (error) {
    logger.warn("avanço inline falhou; a fila vai reprocessar", {
      sagaId,
      error: errorMessage(error),
    });
    return null;
  }
}

/** Handler do job `saga.advance`. Ele mesmo resolve o destino do job. */
export async function handleSagaAdvanceJob(job: ClaimedJob, options: AdvanceOptions = {}): Promise<void> {
  const sagaId = typeof job.payload.sagaId === "string" ? job.payload.sagaId : null;
  if (!sagaId) {
    await queue.fail(job.id, "job sem sagaId no payload");
    return;
  }

  const outcome = await advanceSaga(sagaId, { workerId: job.payload.workerId as string | undefined, ...options });
  await syncQueue(sagaId, outcome, { jobId: job.id });
}

/**
 * Handler do job `saga.reply`: a resposta de um passo remoto. Aplica (uma vez
 * só) e avança a saga. Se outro executor estiver com a saga, a resposta volta
 * pra fila em vez de se perder — ele pode já ter olhado o passo antes de a
 * resposta chegar e ido embora com `waiting`.
 */
export async function handleSagaReplyJob(job: ClaimedJob, options: AdvanceOptions = {}): Promise<void> {
  const reply = parseStepReply(job.payload);
  if (!reply) {
    await queue.fail(job.id, "resposta de passo remoto inválida");
    return;
  }

  const applied = await applyStepReply(reply);
  const outcome = await advanceSaga(reply.sagaId, { workerId: job.payload.workerId as string | undefined, ...options });

  if (outcome.status === "busy") {
    await queue.release(job.id, { delayMs: 1_000 });
    return;
  }

  logger.debug("resposta de passo remoto", { sagaId: reply.sagaId, step: reply.step, phase: reply.phase, applied });
  await syncQueue(reply.sagaId, outcome, { jobId: null });
  await queue.complete(job.id);
}

async function syncQueue(
  sagaId: string,
  outcome: AdvanceOutcome,
  context: { jobId: string | null },
): Promise<void> {
  const dedupeKey = advanceDedupeKey(sagaId);

  switch (outcome.status) {
    case "retry": {
      if (context.jobId) {
        await queue.fail(context.jobId, `${outcome.step}: ${outcome.reason}`, { runAt: outcome.runAt });
        return;
      }
      await queue.scheduleByDedupeKey(
        dedupeKey,
        { type: SAGA_ADVANCE_JOB, payload: { sagaId }, runAt: outcome.runAt },
        { error: `${outcome.step}: ${outcome.reason}` },
      );
      return;
    }

    case "busy": {
      if (context.jobId) await queue.release(context.jobId, { delayMs: 1_000 });
      return;
    }

    case "waiting":
    case "completed":
    case "compensated":
    case "failed":
    case "settled":
    case "not-found": {
      await queue.settleByDedupeKey(dedupeKey);
      if (context.jobId) await queue.complete(context.jobId);
      return;
    }
  }
}
