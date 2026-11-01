/**
 * Raiz de composição: o único lugar (fora de `src/scripts`) que pluga os
 * handlers dos serviços na fila. Usada pelo worker de pé (push) e pelo worker
 * embutido da Vercel (`INLINE_WORKER=1`, pull depois dos requests + cron) —
 * mesmas filas, mesma política de retry.
 */

import { db } from "@/db";
import { createLogger } from "@/lib/logger";
import { sagaHandlers } from "@/queue/handlers";
import { pruneOutbox, type NamedOutbox } from "@/queue/relay";
import { drainQueues, type DrainReport, type Handlers } from "@/queue/worker";
import { rootCauseMessage } from "@/shared/errors";
import { SAGA_QUEUE } from "@/saga/messaging";
import { reconcile, type ReconcileReport } from "@/saga/reconcile";
import { createNotificationHandlers } from "@/services/notifications/delivery";
import { NOTIFICATIONS_QUEUE } from "@/services/notifications";
import { paymentHandlers } from "@/services/payments/consumer";
import { paymentsDb } from "@/services/payments/db";
import { PAYMENTS_QUEUE } from "@/services/payments/contract";
import { pruneRateLimits } from "@/services/rate-limit";
import { pruneExpiredSessions } from "@/services/sessions";

const logger = createLogger("worker");

/** Todas as filas do sistema (painel, worker embutido). */
export const ALL_QUEUES = [SAGA_QUEUE, PAYMENTS_QUEUE, NOTIFICATIONS_QUEUE];

/**
 * As duas caixas de saída: a da loja e a de pagamentos (cada uma no banco
 * dela). O worker embutido roda pagamentos no mesmo processo, então publica
 * as duas; em container, cada processo publica a sua. O nome é o que o log e
 * o painel mostram quando o banco de uma não responde.
 */
export const STORE_OUTBOX: NamedOutbox = { name: "loja", database: db };
const PAYMENTS_OUTBOX: NamedOutbox = { name: "pagamentos", database: paymentsDb };
export const ALL_OUTBOXES: NamedOutbox[] = [STORE_OUTBOX, PAYMENTS_OUTBOX];

/** Mensagem publicada fica 7 dias na outbox (auditoria) e depois sai. */
const OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60_000;

export function workerHandlers(): Handlers {
  return { ...sagaHandlers, ...paymentHandlers, ...createNotificationHandlers() };
}

/**
 * Faxina que só um executor periódico faz (worker de pé ou cron). Cada parte
 * isolada: o banco de pagamentos fora não impede de limpar o da loja.
 */
export async function housekeeping(): Promise<void> {
  const jobs: Array<[string, () => Promise<number>]> = [
    ["rateLimits", () => pruneRateLimits(db, 24 * 60 * 60)],
    ["sessions", () => pruneExpiredSessions(db)],
    ...ALL_OUTBOXES.map(({ name, database }): [string, () => Promise<number>] => [
      `outbox:${name}`,
      () => pruneOutbox(database, OUTBOX_RETENTION_MS),
    ]),
  ];
  const results = await Promise.allSettled(jobs.map(([, run]) => run()));
  const removed: Record<string, number> = {};
  results.forEach((result, index) => {
    const [name] = jobs[index];
    if (result.status === "rejected") {
      logger.warn("faxina falhou numa parte; as outras seguiram", { part: name, error: rootCauseMessage(result.reason) });
    } else if (result.value > 0) {
      removed[name] = result.value;
    }
  });
  if (Object.keys(removed).length > 0) logger.info("faxina", removed);
}

export type InlineRunOptions = {
  /** Tempo máximo drenando; tem que caber no `maxDuration` da rota. */
  budgetMs: number;
  /** Espera retries nas filas de espera que voltam dentro do orçamento. */
  waitForScheduled?: boolean;
  /** Reconcilia antes (leases vencidos, sagas paradas) — cron e admin. */
  reconcile?: boolean;
  /** Faxina (rate limit, outbox publicada) — só o cron. */
  housekeeping?: boolean;
};

const emptyReport = (): DrainReport => ({ received: 0, acked: 0, retried: 0, dead: 0 });

/**
 * Uma rodada do worker embutido. Nunca lança: é chamado depois da resposta.
 * Cada fase isolada — reconciliação ou faxina que falha não impede o dreno,
 * que é o que leva o pedido do cliente adiante. (O dreno publica as outboxes
 * a cada volta, então não há relay separado antes dele.)
 */
export async function runInlineWorker(
  options: InlineRunOptions,
): Promise<DrainReport & { reconciled?: ReconcileReport }> {
  const reconciled = options.reconcile ? await isolated("reconciliação", () => reconcile()) : undefined;
  if (options.housekeeping) await isolated("faxina", housekeeping);
  const report =
    (await isolated("dreno", () =>
      drainQueues({
        outboxes: ALL_OUTBOXES,
        queues: ALL_QUEUES,
        handlers: workerHandlers(),
        budgetMs: options.budgetMs,
        waitForScheduled: options.waitForScheduled,
      }),
    )) ?? emptyReport();
  if (report.received > 0) logger.info("worker embutido drenou a fila", report);
  return { ...report, ...(reconciled ? { reconciled } : {}) };
}

async function isolated<T>(phase: string, run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch (error) {
    logger.error(`worker embutido: ${phase} falhou`, { error: rootCauseMessage(error) });
    return undefined;
  }
}
