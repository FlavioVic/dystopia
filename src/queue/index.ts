/**
 * Fila durável em Postgres.
 *
 * Por que uma tabela e não Kafka/RabbitMQ: o produtor é sempre uma transação
 * de negócio. Gravar o job na MESMA transação (padrão outbox) dá entrega
 * garantida sem commit em dois lugares — com broker externo seria preciso
 * outbox + relay de qualquer forma. Ver README › Decisões.
 *
 * Garantias:
 * - **at-least-once**: o job só sai da fila depois de `complete()`;
 * - **sem processamento duplicado em paralelo**: `claim()` usa
 *   `FOR UPDATE SKIP LOCKED`, então dois workers nunca pegam a mesma linha;
 * - **sem job duplicado**: índice único parcial em `dedupe_key` para os
 *   status ativos (`queued`/`running`/`failed`) + `ON CONFLICT DO NOTHING`;
 * - **retry com backoff** e **dead-letter** depois de `maxAttempts`;
 * - **lease**: job travado por um worker morto volta pra fila na
 *   reconciliação (`src/saga/reconcile.ts`).
 */

import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { jobs } from "@/db/schema";
import { nextRunAt, type BackoffOptions } from "./backoff";

export const DEFAULT_QUEUE = "default";
export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_LEASE_MS = 30_000;

/** Status em que um job ainda é "ativo" (conta pro índice de deduplicação). */
export const ACTIVE_JOB_STATUSES = ["queued", "running", "failed"] as const;

export type JobRow = typeof jobs.$inferSelect;

export type EnqueueInput = {
  type: string;
  payload?: Record<string, unknown>;
  queue?: string;
  runAt?: Date;
  maxAttempts?: number;
  /** Se já existir job ativo com essa chave, o enqueue é ignorado. */
  dedupeKey?: string | null;
};

export type ClaimedJob = {
  id: string;
  queue: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  dedupeKey: string | null;
};

/**
 * Enfileira um job. Deve ser chamado DENTRO da transação que gera o fato de
 * negócio (outbox) — assim ou os dois acontecem, ou nenhum.
 *
 * Retorna `null` quando o job foi deduplicado (já havia um ativo igual).
 */
export async function enqueue(executor: Executor, input: EnqueueInput): Promise<{ id: string } | null> {
  const rows = await executor
    .insert(jobs)
    .values({
      queue: input.queue ?? DEFAULT_QUEUE,
      type: input.type,
      payload: input.payload ?? {},
      runAt: input.runAt ?? new Date(),
      maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      dedupeKey: input.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: jobs.id });

  return rows[0] ?? null;
}

/**
 * Pega até `limit` jobs prontos pra rodar e marca como `running`.
 *
 * `FOR UPDATE SKIP LOCKED` dentro de um subselect é o que faz a fila ser
 * segura com N workers: quem não conseguir a trava simplesmente pula a linha
 * em vez de esperar.
 */
export async function claim(
  options: {
    workerId: string;
    limit?: number;
    queues?: string[];
    leaseMs?: number;
    now?: Date;
    executor?: Executor;
  },
): Promise<ClaimedJob[]> {
  const executor = options.executor ?? db;
  const limit = options.limit ?? 1;
  const queues = options.queues ?? [DEFAULT_QUEUE];
  const now = options.now ?? new Date();
  const leaseUntil = new Date(now.getTime() + (options.leaseMs ?? DEFAULT_LEASE_MS));
  const queueList = sql.join(
    queues.map((q) => sql`${q}`),
    sql`, `,
  );

  const result = await executor.execute(sql`
    update jobs as j
       set status      = 'running',
           attempts    = j.attempts + 1,
           locked_by   = ${options.workerId},
           locked_at   = ${now},
           lease_until = ${leaseUntil},
           updated_at  = ${now}
     where j.id in (
             select id
               from jobs
              where status in ('queued', 'failed')
                and run_at <= ${now}
                and queue in (${queueList})
              order by run_at asc, created_at asc
              limit ${limit}
                for update skip locked
           )
    returning j.id, j.queue, j.type, j.payload, j.attempts, j.max_attempts, j.dedupe_key
  `);

  const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows ?? [];
  return rows.map((row) => ({
    id: String(row.id),
    queue: String(row.queue),
    type: String(row.type),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    dedupeKey: row.dedupe_key == null ? null : String(row.dedupe_key),
  }));
}

/** Job processado com sucesso. */
export async function complete(jobId: string, options: { executor?: Executor; now?: Date } = {}): Promise<void> {
  const executor = options.executor ?? db;
  const now = options.now ?? new Date();
  await executor
    .update(jobs)
    .set({ status: "done", finishedAt: now, updatedAt: now, lockedBy: null, leaseUntil: null, lastError: null })
    .where(eq(jobs.id, jobId));
}

export type FailResult = { status: "failed"; runAt: Date; attempts: number } | { status: "dead"; attempts: number };

/**
 * Job falhou: reagenda com backoff enquanto houver tentativa sobrando, ou
 * manda pra dead-letter (`dead`).
 */
export async function fail(
  jobId: string,
  error: string,
  options: { executor?: Executor; now?: Date; backoff?: BackoffOptions; runAt?: Date } = {},
): Promise<FailResult> {
  const executor = options.executor ?? db;
  const now = options.now ?? new Date();

  const job = await executor.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) throw new Error(`Job ${jobId} não existe.`);

  const message = truncateError(error);

  if (job.attempts >= job.maxAttempts) {
    await executor
      .update(jobs)
      .set({ status: "dead", lastError: message, finishedAt: now, updatedAt: now, lockedBy: null, leaseUntil: null })
      .where(eq(jobs.id, jobId));
    return { status: "dead", attempts: job.attempts };
  }

  const runAt = options.runAt ?? nextRunAt(job.attempts, now, options.backoff);
  await executor
    .update(jobs)
    .set({ status: "failed", lastError: message, runAt, updatedAt: now, lockedBy: null, leaseUntil: null })
    .where(eq(jobs.id, jobId));
  return { status: "failed", runAt, attempts: job.attempts };
}

/**
 * Devolve o job pra fila SEM gastar tentativa — pra quando o worker pegou o
 * job mas não era a vez dele (ex.: a saga está travada por outro executor).
 */
export async function release(
  jobId: string,
  options: { executor?: Executor; now?: Date; delayMs?: number } = {},
): Promise<void> {
  const executor = options.executor ?? db;
  const now = options.now ?? new Date();
  await executor
    .update(jobs)
    .set({
      status: "queued",
      attempts: sql`greatest(0, ${jobs.attempts} - 1)`,
      runAt: new Date(now.getTime() + (options.delayMs ?? 1_000)),
      updatedAt: now,
      lockedBy: null,
      leaseUntil: null,
    })
    .where(eq(jobs.id, jobId));
}

/**
 * Quando pode aparecer o próximo job pronto nestas filas: o `run_at` do
 * próximo esperando (retry em backoff, job agendado) ou "agora" se há job
 * `running` com outro executor — ele pode falhar e virar retry, ou gerar job
 * novo (a resposta de um passo remoto). `null` = nada em andamento. Quem drena
 * a fila sem ser processo de longa duração (o worker embutido na Vercel) usa
 * pra decidir se vale esperar mais um pouco ou encerrar.
 */
export async function nextScheduledAt(
  queues: string[] = [DEFAULT_QUEUE],
  options: { executor?: Executor; now?: Date } = {},
): Promise<Date | null> {
  const executor = options.executor ?? db;
  const now = options.now ?? new Date();
  const [row] = await executor
    .select({
      runAt: sql<Date | string | null>`min(case when ${jobs.status} = 'running' then ${now} else ${jobs.runAt} end)`,
    })
    .from(jobs)
    .where(
      and(
        inArray(jobs.queue, queues),
        // `running` de lease vencido é executor morto: quem cuida é a
        // reconciliação, não vale segurar o dreno esperando por ele.
        sql`(${jobs.status} in ('queued', 'failed') or (${jobs.status} = 'running' and ${jobs.leaseUntil} > ${now}))`,
      ),
    );
  return row?.runAt ? new Date(row.runAt) : null;
}

/** Jobs ativos com uma dedupe key (0 ou 1, por causa do índice único parcial). */
export async function findActiveByDedupeKey(
  dedupeKey: string,
  options: { executor?: Executor } = {},
): Promise<JobRow | undefined> {
  const executor = options.executor ?? db;
  return executor.query.jobs.findFirst({
    where: and(eq(jobs.dedupeKey, dedupeKey), inArray(jobs.status, [...ACTIVE_JOB_STATUSES])),
  });
}

/** Reagenda (ou cria) o job ativo de uma dedupe key. Usado pelos retries da saga. */
export async function scheduleByDedupeKey(
  dedupeKey: string,
  input: EnqueueInput & { runAt: Date },
  options: { executor?: Executor; now?: Date; error?: string } = {},
): Promise<"rescheduled" | "created"> {
  const executor = options.executor ?? db;
  const now = options.now ?? new Date();

  const updated = await executor
    .update(jobs)
    .set({
      status: "failed",
      runAt: input.runAt,
      updatedAt: now,
      lockedBy: null,
      leaseUntil: null,
      lastError: options.error ? truncateError(options.error) : null,
    })
    .where(and(eq(jobs.dedupeKey, dedupeKey), inArray(jobs.status, [...ACTIVE_JOB_STATUSES])))
    .returning({ id: jobs.id });

  if (updated.length > 0) return "rescheduled";

  await enqueue(executor, { ...input, dedupeKey });
  return "created";
}

/** Fecha os jobs ativos de uma dedupe key — o trabalho já foi feito por outro caminho. */
export async function settleByDedupeKey(
  dedupeKey: string,
  options: { executor?: Executor; now?: Date } = {},
): Promise<number> {
  const executor = options.executor ?? db;
  const now = options.now ?? new Date();
  const rows = await executor
    .update(jobs)
    .set({ status: "done", finishedAt: now, updatedAt: now, lockedBy: null, leaseUntil: null })
    .where(and(eq(jobs.dedupeKey, dedupeKey), inArray(jobs.status, [...ACTIVE_JOB_STATUSES])))
    .returning({ id: jobs.id });
  return rows.length;
}

/** Jobs `running` cujo lease venceu (worker morreu) voltam pra fila. */
export async function requeueExpiredLeases(
  options: { executor?: Executor; now?: Date } = {},
): Promise<number> {
  const executor = options.executor ?? db;
  const now = options.now ?? new Date();
  const rows = await executor
    .update(jobs)
    .set({ status: "queued", lockedBy: null, leaseUntil: null, runAt: now, updatedAt: now })
    .where(and(eq(jobs.status, "running"), lt(jobs.leaseUntil, now)))
    .returning({ id: jobs.id });
  return rows.length;
}

/** Reprocessa um job da dead-letter (usado pelo painel admin). */
export async function retryDeadJob(
  jobId: string,
  options: { executor?: Executor; now?: Date } = {},
): Promise<boolean> {
  const executor = options.executor ?? db;
  const now = options.now ?? new Date();
  const rows = await executor
    .update(jobs)
    .set({ status: "queued", attempts: 0, runAt: now, updatedAt: now, finishedAt: null, lastError: null })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "dead")))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

function truncateError(message: string): string {
  return message.length > 2_000 ? `${message.slice(0, 2_000)}…` : message;
}
