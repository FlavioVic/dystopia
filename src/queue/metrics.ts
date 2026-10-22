/**
 * Métricas da fila — leitura agregada no banco, pro painel e pros alertas.
 *
 * Genérico como o resto de `queue/`: não sabe o que os jobs fazem. Tudo é
 * contado com GROUP BY no Postgres; trazer as linhas pra contar em memória
 * fica mais lento a cada pedido.
 */

import { sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { jobs } from "@/db/schema";

export type QueueMetrics = {
  byStatus: Record<string, number>;
  /** Jobs na dead-letter (esgotaram as tentativas). */
  dead: number;
  /** Jobs prontos pra rodar agora — o mesmo critério do `claim`. */
  ready: number;
  /**
   * Quanto o job pronto mais antigo já esperou, em ms (0 se não há nenhum).
   * Com o worker vivo fica perto do intervalo de polling; crescendo sem parar,
   * ninguém está consumindo a fila.
   */
  oldestReadyAgeMs: number;
};

export async function getQueueMetrics(executor: Executor, options: { now?: Date } = {}): Promise<QueueMetrics> {
  const now = options.now ?? new Date();

  const rows = await executor
    .select({ status: jobs.status, count: sql<number>`count(*)::int` })
    .from(jobs)
    .groupBy(jobs.status);
  const byStatus = Object.fromEntries(rows.map((row) => [row.status, row.count]));

  const [ready] = await executor
    .select({
      count: sql<number>`count(*)::int`,
      oldestMs: sql<number | null>`(extract(epoch from (${now.toISOString()}::timestamptz - min(${jobs.runAt}))) * 1000)::bigint`,
    })
    .from(jobs)
    // `failed` aqui é "aguardando retry": com run_at vencido, o claim pega igual
    .where(sql`${jobs.status} in ('queued', 'failed') and ${jobs.runAt} <= ${now.toISOString()}::timestamptz`);

  return {
    byStatus,
    dead: byStatus.dead ?? 0,
    ready: ready.count,
    oldestReadyAgeMs: Math.max(0, Number(ready.oldestMs ?? 0)),
  };
}
