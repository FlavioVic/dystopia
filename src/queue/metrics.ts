/**
 * Métricas da fila, pro painel e pros alertas. Genérico como o resto de
 * `queue/`: não sabe o que as mensagens fazem.
 *
 * Duas fontes:
 * - **outbox** (Postgres): o que ainda não chegou no broker. Crescendo sem
 *   parar = relay parado ou broker fora;
 * - **broker** (RabbitMQ): por fila, quanto está pronto, esperando retry e na
 *   DLQ. Broker inacessível não derruba o painel: vira `broker: "down"`.
 */

import { sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { outbox } from "@/db/schema";
import { errorMessage } from "@/saga/errors";
import { queueDepths, type QueueDepth } from "./broker";

export type OutboxMetrics = {
  /** Mensagens gravadas e ainda não confirmadas pelo broker. */
  pending: number;
  /** Há quanto tempo a mais antiga espera publicação, em ms (0 = nenhuma). */
  oldestPendingAgeMs: number;
  /** Pendentes que já falharam ao publicar pelo menos uma vez. */
  failing: number;
};

export type QueueMetrics = {
  outbox: OutboxMetrics;
  broker: { status: "up" } | { status: "down"; error: string };
  queues: QueueDepth[];
  ready: number;
  retrying: number;
  /** Mensagens na DLQ (esgotaram as tentativas ou erro permanente). */
  dead: number;
};

export async function getOutboxMetrics(executor: Executor, options: { now?: Date } = {}): Promise<OutboxMetrics> {
  const now = options.now ?? new Date();
  const [row] = await executor
    .select({
      pending: sql<number>`count(*)::int`,
      failing: sql<number>`count(*) filter (where ${outbox.publishAttempts} > 0)::int`,
      oldestMs: sql<number | null>`(extract(epoch from (${now.toISOString()}::timestamptz - min(${outbox.createdAt}))) * 1000)::bigint`,
    })
    .from(outbox)
    .where(sql`${outbox.publishedAt} is null`);
  return {
    pending: row.pending,
    failing: row.failing,
    oldestPendingAgeMs: Math.max(0, Number(row.oldestMs ?? 0)),
  };
}

export async function getQueueMetrics(
  executor: Executor,
  options: { queues: string[]; now?: Date },
): Promise<QueueMetrics> {
  const outboxMetrics = await getOutboxMetrics(executor, options);
  try {
    const queues = await queueDepths(options.queues);
    const sum = (key: "ready" | "retrying" | "dead") => queues.reduce((total, depth) => total + depth[key], 0);
    return {
      outbox: outboxMetrics,
      broker: { status: "up" },
      queues,
      ready: sum("ready"),
      retrying: sum("retrying"),
      dead: sum("dead"),
    };
  } catch (error) {
    return {
      outbox: outboxMetrics,
      broker: { status: "down", error: errorMessage(error) },
      queues: [],
      ready: 0,
      retrying: 0,
      dead: 0,
    };
  }
}
