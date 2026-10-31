/**
 * Raiz de composição: o único lugar (fora de `src/scripts`) que pluga os
 * handlers dos serviços na fila. Usada pelo worker de pé (push) e pelo worker
 * embutido da Vercel (`INLINE_WORKER=1`, pull depois dos requests + cron) —
 * mesmas filas, mesma política de retry.
 */

import { db } from "@/db";
import { createLogger } from "@/lib/logger";
import { sagaHandlers } from "@/queue/handlers";
import { pruneOutbox, relayAll, type OutboxDatabase } from "@/queue/relay";
import { drainQueues, type DrainReport, type Handlers } from "@/queue/worker";
import { errorMessage } from "@/shared/errors";
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
 * as duas; em container, cada processo publica a sua.
 */
export const ALL_OUTBOXES: OutboxDatabase[] = [db, paymentsDb];

/** Mensagem publicada fica 7 dias na outbox (auditoria) e depois sai. */
const OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60_000;

export function workerHandlers(): Handlers {
  return { ...sagaHandlers, ...paymentHandlers, ...createNotificationHandlers() };
}

/** Faxina que só um executor periódico faz (worker de pé ou cron). */
export async function housekeeping(): Promise<void> {
  const [rateLimits, sessions, ...outboxes] = await Promise.all([
    pruneRateLimits(db, 24 * 60 * 60),
    pruneExpiredSessions(db),
    ...ALL_OUTBOXES.map((database) => pruneOutbox(database, OUTBOX_RETENTION_MS)),
  ]);
  const published = outboxes.reduce((sum, count) => sum + count, 0);
  if (rateLimits + published + sessions > 0) logger.info("faxina", { rateLimits, outbox: published, sessions });
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

/** Uma rodada do worker embutido. Nunca lança: é chamado depois da resposta. */
export async function runInlineWorker(
  options: InlineRunOptions,
): Promise<DrainReport & { reconciled?: ReconcileReport }> {
  try {
    const reconciled = options.reconcile ? await reconcile() : undefined;
    if (options.housekeeping) await housekeeping();
    await relayAll(ALL_OUTBOXES);
    const report = await drainQueues({
      outboxes: ALL_OUTBOXES,
      queues: ALL_QUEUES,
      handlers: workerHandlers(),
      budgetMs: options.budgetMs,
      waitForScheduled: options.waitForScheduled,
    });
    if (report.received > 0) logger.info("worker embutido drenou a fila", report);
    return { ...report, ...(reconciled ? { reconciled } : {}) };
  } catch (error) {
    logger.error("worker embutido falhou", { error: errorMessage(error) });
    return emptyReport();
  }
}
