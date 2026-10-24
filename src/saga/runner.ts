/**
 * Cola entre a saga e a fila: o resultado de `advanceSaga` vira a resposta do
 * handler. `retry`/`busy` voltam pela fila de espera sem gastar tentativa da
 * mensagem (quem conta tentativa é o passo); o resto é `ack`.
 *
 * Dois caminhos pro mesmo código — o request do checkout (`runSagaInline`,
 * até o passo remoto) e o consumidor (`handleSagaAdvance`, o durável). O
 * lease da saga deixa os dois, e mensagem repetida, rodarem ao mesmo tempo.
 */

import { db, type Executor } from "@/db";
import { sagas } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import * as queue from "@/queue";
import type { HandlerResult, QueueMessage } from "@/queue";
import { advanceSaga, applyStepReply, type AdvanceOptions, type AdvanceOutcome } from "./orchestrator";
import { errorMessage, PermanentError } from "./errors";
import { parseStepReply, SAGA_ADVANCE, SAGA_QUEUE } from "./messaging";

const logger = createLogger("saga:runner");

/** Folga mínima pra reolhar uma saga ocupada. */
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

  await enqueueAdvance(executor, saga.id);
  return { sagaId: saga.id };
}

/** Mensagem de avanço (opcionalmente adiada) — usada também pela reconciliação. */
export async function enqueueAdvance(executor: Executor, sagaId: string, delayMs = 0): Promise<void> {
  await queue.enqueue(executor, { type: SAGA_ADVANCE, queue: SAGA_QUEUE, payload: { sagaId }, delayMs });
}

/**
 * Avança a saga agora, no processo atual. Se o passo pediu retry, deixa um
 * avanço adiado na outbox: a mensagem original pode já ter sido consumida.
 * Duplicata não faz mal — o lease segura a saga até a hora do retry.
 */
export async function runSagaInline(sagaId: string, options: AdvanceOptions = {}): Promise<AdvanceOutcome> {
  const outcome = await advanceSaga(sagaId, { workerId: "inline", ...options });
  if (outcome.status === "retry") {
    await enqueueAdvance(db, sagaId, outcome.runAt.getTime() - Date.now());
  }
  return outcome;
}

/**
 * Versão "nunca quebra o request": usada pelo checkout. Se qualquer coisa
 * explodir aqui, o pedido já está salvo e a mensagem na outbox — o worker assume.
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

/** Handler de `saga.advance`. */
export async function handleSagaAdvance(message: QueueMessage, options: AdvanceOptions = {}): Promise<HandlerResult> {
  const sagaId = typeof message.payload.sagaId === "string" ? message.payload.sagaId : null;
  if (!sagaId) throw new PermanentError("invalid_message", "saga.advance sem sagaId no payload");
  return toHandlerResult(await advanceSaga(sagaId, options));
}

/**
 * Handler de `saga.reply`: a resposta de um passo remoto. Aplica (uma vez só)
 * e avança a saga. Se outro executor estiver com a saga, a resposta volta pra
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
    case "completed":
    case "compensated":
    case "failed":
    case "settled":
    case "not-found":
      return;
  }
}
