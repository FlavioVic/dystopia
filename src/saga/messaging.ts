/**
 * Mensageria dos passos remotos: envia o comando de um passo e lê a resposta.
 *
 * O orquestrador continua sem conhecer a fila — chama `dispatchStepRequest`
 * dentro da transação do passo (outbox) e recebe `StepReply` já validado.
 * Fica fora do runner porque o runner importa o orquestrador.
 */

import type { Transaction } from "@/db";
import { enqueue } from "@/queue";
import { readReplyResult, withReplyTo, type ReplyResult } from "@/queue/reply";
import type { StepPhase, StepRequest } from "./types";

export type { StepPhase };

/** Fila da orquestração: avanços e respostas de passo remoto. */
export const SAGA_QUEUE = "saga";
/** Avança a saga a partir de onde ela parou. */
export const SAGA_ADVANCE = "saga.advance";
/** Resposta de um passo remoto (o `replyTo` dos comandos). */
export const SAGA_REPLY = "saga.reply";

/**
 * O que a resposta responde: o próprio comando do passo, ou a consulta de
 * status feita quando o prazo dele venceu.
 */
export type ReplyKind = "command" | "status";

export type StepReply = {
  sagaId: string;
  step: string;
  phase: StepPhase;
  kind: ReplyKind;
  result: ReplyResult;
};

/** Enfileira o comando do passo (ou a consulta de status) com o endereço de resposta da saga. */
export async function dispatchStepRequest(
  tx: Transaction,
  input: {
    sagaId: string;
    step: string;
    phase: StepPhase;
    request: StepRequest;
    maxAttempts: number;
    kind?: ReplyKind;
  },
): Promise<void> {
  const conversation = { sagaId: input.sagaId, step: input.step, phase: input.phase, kind: input.kind ?? "command" };
  await enqueue(tx, {
    type: input.request.type,
    queue: input.request.queue,
    maxAttempts: input.maxAttempts,
    payload: withReplyTo(input.request.payload, { type: SAGA_REPLY, queue: SAGA_QUEUE, payload: conversation }),
  });
}

export function parseStepReply(payload: Record<string, unknown>): StepReply | null {
  const { sagaId, step, phase, kind } = payload;
  const result = readReplyResult(payload);
  if (typeof sagaId !== "string" || typeof step !== "string" || !result) return null;
  if (phase !== "invoke" && phase !== "compensate") return null;
  // Resposta sem `kind` é de comando (mensagens gravadas antes da consulta existir).
  return { sagaId, step, phase, kind: kind === "status" ? "status" : "command", result };
}
