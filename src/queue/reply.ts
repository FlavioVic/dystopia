/**
 * Request/reply sobre a fila — "endereço de resposta" no próprio comando.
 *
 * Quem pede manda, junto com o comando, um `replyTo`: o tipo de mensagem, a
 * fila e o payload que identificam a conversa do lado de quem pediu. Quem atende só
 * devolve o resultado nesse endereço, sem saber se do outro lado há uma saga,
 * um script ou outro serviço. É o que deixa pagamentos ignorar a saga.
 *
 * Entrega é "pelo menos uma vez": a mesma resposta pode chegar duas vezes
 * (comando reprocessado depois de um crash, reentrega do broker). Quem
 * recebe tem que ser idempotente.
 */

import type { Executor } from "@/db";
import { enqueue } from "./index";

export type ReplyTo = {
  type: string;
  queue: string;
  payload: Record<string, unknown>;
};

export type ReplyResult =
  | { ok: true; output: Record<string, unknown>; attempts: number }
  | { ok: false; code: string; message: string; attempts: number };

/** Chave do `replyTo` dentro do payload do comando. */
const REPLY_TO = "replyTo";
/** Chave do resultado dentro do payload da resposta. */
const RESULT = "result";

export function withReplyTo(payload: Record<string, unknown>, replyTo: ReplyTo): Record<string, unknown> {
  return { ...payload, [REPLY_TO]: replyTo };
}

export function readReplyTo(payload: Record<string, unknown>): ReplyTo | null {
  const raw = payload[REPLY_TO];
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<ReplyTo>;
  if (typeof candidate.type !== "string" || typeof candidate.queue !== "string") return null;
  if (!candidate.payload || typeof candidate.payload !== "object") return null;
  return { type: candidate.type, queue: candidate.queue, payload: candidate.payload };
}

/**
 * Responde no endereço pedido. Chamar na MESMA transação do efeito (outbox):
 * cobrança e resposta commitam juntas, então não existe cobrança sem aviso.
 */
export async function sendReply(
  executor: Pick<Executor, "insert">,
  replyTo: ReplyTo,
  result: ReplyResult,
): Promise<void> {
  await enqueue(executor, {
    type: replyTo.type,
    queue: replyTo.queue,
    payload: { ...replyTo.payload, [RESULT]: result },
  });
}

export function readReplyResult(payload: Record<string, unknown>): ReplyResult | null {
  const raw = payload[RESULT];
  if (!raw || typeof raw !== "object") return null;
  const result = raw as Record<string, unknown>;
  const attempts = typeof result.attempts === "number" ? result.attempts : 1;
  if (result.ok === true && result.output && typeof result.output === "object") {
    return { ok: true, output: result.output as Record<string, unknown>, attempts };
  }
  if (result.ok === false && typeof result.code === "string" && typeof result.message === "string") {
    return { ok: false, code: result.code, message: result.message, attempts };
  }
  return null;
}
