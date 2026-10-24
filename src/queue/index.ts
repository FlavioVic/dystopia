/**
 * Fila de mensagens: RabbitMQ, com outbox transacional no Postgres. O
 * produtor só grava na outbox, dentro da transação de negócio (publicar
 * direto no broker seria dual write); o relay publica. Entrega é "pelo menos
 * uma vez" — todo consumidor é idempotente. Desenho e política de retry em
 * docs/ARQUITETURA.md › A fila.
 */

import type { Executor } from "@/db";
import { outbox } from "@/db/schema";

export const DEFAULT_MAX_ATTEMPTS = 5;

export type EnqueueInput = {
  type: string;
  /** Fila lógica de destino ("saga", "payments", "notifications"…). */
  queue: string;
  payload?: Record<string, unknown>;
  /** Tentativas de processamento antes da DLQ. */
  maxAttempts?: number;
  /** Entrega adiada: sai pela fila de espera que cobre esse atraso. */
  delayMs?: number;
};

/** Grava a mensagem na outbox — DENTRO da transação do fato de negócio. */
export async function enqueue(executor: Executor, input: EnqueueInput): Promise<{ id: string }> {
  const [row] = await executor
    .insert(outbox)
    .values({
      queue: input.queue,
      type: input.type,
      payload: input.payload ?? {},
      maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      delayMs: Math.max(0, Math.round(input.delayMs ?? 0)),
    })
    .returning({ id: outbox.id });
  return row;
}

/** Mensagem entregue a um handler. */
export type QueueMessage = {
  /** Id estável (o da outbox): igual em toda reentrega da mesma mensagem. */
  id: string;
  queue: string;
  type: string;
  payload: Record<string, unknown>;
  /** Tentativa atual (1 = primeira entrega). */
  attempt: number;
  maxAttempts: number;
};

/**
 * Nada = `ack`. `{ retryInMs }` = volta pela fila de espera; com
 * `countAttempt: false` não é falha (saga ocupada/em backoff) e não leva à
 * DLQ. Lançar = falha: retry com backoff, ou DLQ se permanente/esgotada.
 */
export type HandlerResult = void | { retryInMs: number; countAttempt?: boolean };
export type MessageHandler = (message: QueueMessage) => Promise<HandlerResult>;
