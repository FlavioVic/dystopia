/**
 * Mensageria dos passos remotos: envia o comando de um passo e lê a resposta.
 *
 * O orquestrador continua sem conhecer a fila — chama `dispatchStepRequest`
 * dentro da transação do passo (outbox) e recebe `StepReply` já validado.
 * Fica fora do runner porque o runner importa o orquestrador.
 */

import type { Transaction } from "@/db";
import { DEFAULT_QUEUE, enqueue } from "@/queue";
import { readReplyResult, withReplyTo, type ReplyResult } from "@/queue/reply";
import type { StepRequest } from "./types";

export const SAGA_REPLY_JOB = "saga.reply";

/** Ida (`invoke`) ou volta (`compensate`) de um passo remoto. */
export type StepPhase = "invoke" | "compensate";

export type StepReply = {
  sagaId: string;
  step: string;
  phase: StepPhase;
  result: ReplyResult;
};

export function stepCommandDedupeKey(sagaId: string, step: string, phase: StepPhase): string {
  return `saga:${sagaId}:${step}:${phase}`;
}

/** Enfileira o comando do passo com o endereço de resposta da saga. */
export async function dispatchStepRequest(
  tx: Transaction,
  input: { sagaId: string; step: string; phase: StepPhase; request: StepRequest; maxAttempts: number },
): Promise<void> {
  const conversation = { sagaId: input.sagaId, step: input.step, phase: input.phase };
  await enqueue(tx, {
    type: input.request.type,
    queue: input.request.queue,
    maxAttempts: input.maxAttempts,
    dedupeKey: stepCommandDedupeKey(input.sagaId, input.step, input.phase),
    payload: withReplyTo(input.request.payload, {
      type: SAGA_REPLY_JOB,
      queue: DEFAULT_QUEUE,
      payload: conversation,
      dedupeKey: `${stepCommandDedupeKey(input.sagaId, input.step, input.phase)}:reply`,
    }),
  });
}

export function parseStepReply(payload: Record<string, unknown>): StepReply | null {
  const { sagaId, step, phase } = payload;
  const result = readReplyResult(payload);
  if (typeof sagaId !== "string" || typeof step !== "string" || !result) return null;
  if (phase !== "invoke" && phase !== "compensate") return null;
  return { sagaId, step, phase, result };
}
