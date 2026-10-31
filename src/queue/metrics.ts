/**
 * Métricas da fila, para o painel e para os alertas. Genérico como o resto de
 * `queue/`: não sabe o que as mensagens fazem.
 *
 * Duas fontes:
 * - **outbox** (Postgres, uma por banco — loja e pagamentos — somadas): o
 *   que ainda não chegou no broker. Crescendo sem parar = relay parado ou
 *   broker fora;
 * - **broker** (RabbitMQ): por fila, quanto está pronto, esperando retry e na
 *   DLQ. Broker inacessível não derruba o painel: vira `broker: "down"`.
 */

import { sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { outbox } from "@/db/outbox";
import { errorMessage } from "@/shared/errors";
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

export async function getOutboxMetrics(
  executor: Pick<Executor, "select">,
  options: { now?: Date } = {},
): Promise<OutboxMetrics> {
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
  executor: Pick<Executor, "select">,
  options: { queues: string[]; now?: Date; outboxes?: Pick<Executor, "select">[] },
): Promise<QueueMetrics> {
  const perOutbox = await Promise.all(
    (options.outboxes ?? [executor]).map((database) => getOutboxMetrics(database, options)),
  );
  const outboxMetrics: OutboxMetrics = {
    pending: perOutbox.reduce((sum, metrics) => sum + metrics.pending, 0),
    failing: perOutbox.reduce((sum, metrics) => sum + metrics.failing, 0),
    oldestPendingAgeMs: Math.max(0, ...perOutbox.map((metrics) => metrics.oldestPendingAgeMs)),
  };
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
