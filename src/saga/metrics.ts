/**
 * Métricas das sagas — agregadas no Postgres, para o painel e para os alertas.
 *
 * Genérico: vale para qualquer `sagas.type`, sem conhecer a definição concreta.
 * As durações são percentis (p50/p95), não média: uma saga que esperou o
 * backoff três vezes puxaria a média e esconderia o caso típico.
 */

import { sql } from "drizzle-orm";
import type { Executor } from "@/db";

export type StepMetrics = {
  name: string;
  position: number;
  executions: number;
  /** Chegou a concluir (inclui os que depois foram desfeitos pela compensação). */
  succeeded: number;
  failed: number;
  /** Precisou de mais de uma tentativa para sair do lugar. */
  retried: number;
  /** Do primeiro início à conclusão — inclui a espera de backoff entre tentativas. */
  p50Ms: number | null;
  p95Ms: number | null;
};

export type SagaMetrics = {
  since: Date;
  byStatus: Record<string, number>;
  total: number;
  /** concluídas / terminadas (concluídas + compensadas + falhas). null sem nenhuma terminada. */
  completionRate: number | null;
  /** Tempo de ponta a ponta das sagas concluídas. */
  p50Ms: number | null;
  p95Ms: number | null;
  /** Em andamento/compensando sem progresso há mais de `stuckAfterMs` (independe da janela). */
  stuck: number;
  /**
   * Passos remotos que estouraram o prazo `OVERDUE_ALERT_CHECKS` vezes ou mais
   * (perguntaram o status e nada voltou) — independe da janela.
   */
  overdueRemote: number;
  steps: StepMetrics[];
};

type Options = {
  since: Date;
  now?: Date;
  type?: string;
  stuckAfterMs?: number;
};

export const DEFAULT_STUCK_AFTER_MS = 5 * 60_000;
/** Consultas de status sem resposta antes de virar alerta (~2 + 4 + 8 min no checkout). */
export const OVERDUE_ALERT_CHECKS = 3;

const ms = (value: unknown) => (value == null ? null : Math.round(Number(value)));

export async function getSagaMetrics(executor: Executor, options: Options): Promise<SagaMetrics> {
  const now = options.now ?? new Date();
  const since = options.since.toISOString();
  const stuckBefore = new Date(now.getTime() - (options.stuckAfterMs ?? DEFAULT_STUCK_AFTER_MS)).toISOString();
  const typeFilter = options.type ? sql`and s.type = ${options.type}` : sql``;

  const statusRows = await executor.execute<{ status: string; count: number }>(sql`
    select s.status, count(*)::int as count
    from sagas s
    where s.created_at >= ${since}::timestamptz ${typeFilter}
    group by s.status
  `);
  const byStatus = Object.fromEntries(statusRows.rows.map((row) => [row.status, row.count]));
  const total = statusRows.rows.reduce((sum, row) => sum + row.count, 0);

  const [durations] = (
    await executor.execute<{ p50: number | null; p95: number | null }>(sql`
      select
        percentile_cont(0.5) within group (order by extract(epoch from (s.finished_at - s.created_at)) * 1000) as p50,
        percentile_cont(0.95) within group (order by extract(epoch from (s.finished_at - s.created_at)) * 1000) as p95
      from sagas s
      where s.created_at >= ${since}::timestamptz and s.status = 'completed' and s.finished_at is not null ${typeFilter}
    `)
  ).rows;

  const [stuck] = (
    await executor.execute<{ count: number }>(sql`
      select count(*)::int as count
      from sagas s
      where s.status in ('running', 'compensating') and s.updated_at < ${stuckBefore}::timestamptz ${typeFilter}
    `)
  ).rows;

  const [overdue] = (
    await executor.execute<{ count: number }>(sql`
      select count(*)::int as count
      from saga_steps st
      join sagas s on s.id = st.saga_id
      where st.status = 'waiting' and st.status_checks >= ${OVERDUE_ALERT_CHECKS} ${typeFilter}
    `)
  ).rows;

  const stepRows = await executor.execute<{
    name: string;
    position: number;
    executions: number;
    succeeded: number;
    failed: number;
    retried: number;
    p50: number | null;
    p95: number | null;
  }>(sql`
    select
      st.name,
      min(st.position)::int as position,
      count(*)::int as executions,
      (count(*) filter (where st.status in ('completed', 'compensated')))::int as succeeded,
      (count(*) filter (where st.status = 'failed'))::int as failed,
      -- num passo desfeito, attempts soma ida e compensação: não conta como retry
      (count(*) filter (where st.status <> 'compensated' and st.attempts > 1))::int as retried,
      percentile_cont(0.5) within group (order by extract(epoch from (st.finished_at - st.started_at)) * 1000)
        filter (where st.status = 'completed') as p50,
      percentile_cont(0.95) within group (order by extract(epoch from (st.finished_at - st.started_at)) * 1000)
        filter (where st.status = 'completed') as p95
    from saga_steps st
    join sagas s on s.id = st.saga_id
    where s.created_at >= ${since}::timestamptz ${typeFilter}
    group by st.name
    order by min(st.position)
  `);

  const finished = (byStatus.completed ?? 0) + (byStatus.compensated ?? 0) + (byStatus.failed ?? 0);

  return {
    since: options.since,
    byStatus,
    total,
    completionRate: finished === 0 ? null : (byStatus.completed ?? 0) / finished,
    p50Ms: ms(durations?.p50),
    p95Ms: ms(durations?.p95),
    stuck: stuck?.count ?? 0,
    overdueRemote: overdue?.count ?? 0,
    steps: stepRows.rows.map((row) => ({
      name: row.name,
      position: row.position,
      executions: row.executions,
      succeeded: row.succeeded,
      failed: row.failed,
      retried: row.retried,
      p50Ms: ms(row.p50),
      p95Ms: ms(row.p95),
    })),
  };
}
