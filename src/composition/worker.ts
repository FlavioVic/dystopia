/**
 * Raiz de composição do worker: o único lugar (fora de `src/scripts`) que
 * pluga os handlers dos serviços na fila. Dois executores usam:
 *
 * - o processo de longa duração (`npm run worker`, container);
 * - o worker embutido (`INLINE_WORKER=1`, deploy só na Vercel): sem processo
 *   ficando de pé, a fila é drenada depois dos requests que deixam trabalho
 *   nela, e por um cron de segurança. É o que deixa a demo rodar de graça —
 *   o banco (Neon) só acorda quando alguém usa o site.
 *
 * O desenho não muda entre os dois: pagamentos continua falando por mensagem
 * (fila `payments`, contrato), só que consumida no mesmo runtime.
 */

import { db } from "@/db";
import { createLogger } from "@/lib/logger";
import { DEFAULT_QUEUE } from "@/queue";
import { drainQueue, type TickReport } from "@/queue/worker";
import { errorMessage } from "@/saga/errors";
import { reconcile, type ReconcileReport } from "@/saga/reconcile";
import { createNotificationHandlers } from "@/services/notifications/delivery";
import { paymentHandlers } from "@/services/payments/consumer";
import { PAYMENTS_QUEUE } from "@/services/payments/contract";
import { pruneRateLimits } from "@/services/rate-limit";

const logger = createLogger("worker");

export function workerHandlers() {
  return { ...paymentHandlers, ...createNotificationHandlers() };
}

export const INLINE_WORKER_QUEUES = [DEFAULT_QUEUE, PAYMENTS_QUEUE];

export type InlineRunOptions = {
  /** Tempo máximo drenando; tem que caber no `maxDuration` da rota. */
  budgetMs: number;
  /** Espera retries em backoff que ficam prontos dentro do orçamento. */
  waitForScheduled?: boolean;
  /** Reconcilia antes (leases vencidos, sagas órfãs) — cron e admin. */
  reconcile?: boolean;
  /** Faxina do rate limit — só o cron. */
  housekeeping?: boolean;
};

/** Uma rodada do worker embutido. Nunca lança: é chamado depois da resposta. */
export async function runInlineWorker(
  options: InlineRunOptions,
): Promise<TickReport & { reconciled?: ReconcileReport }> {
  const empty: TickReport = { claimed: 0, completed: 0, failed: 0, unknown: 0 };
  try {
    const reconciled = options.reconcile ? await reconcile() : undefined;
    if (options.housekeeping) await pruneRateLimits(db, 24 * 60 * 60);
    const report = await drainQueue({
      workerId: "inline",
      queues: INLINE_WORKER_QUEUES,
      handlers: workerHandlers(),
      batchSize: 5,
      budgetMs: options.budgetMs,
      maxTicks: 500,
      waitForScheduled: options.waitForScheduled,
    });
    if (report.claimed > 0) logger.info("worker embutido drenou a fila", report);
    return { ...report, ...(reconciled ? { reconciled } : {}) };
  } catch (error) {
    logger.error("worker embutido falhou", { error: errorMessage(error) });
    return empty;
  }
}
