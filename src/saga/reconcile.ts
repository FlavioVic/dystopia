/**
 * Fluxo de sincronização (reconciliação).
 *
 * Fila + saga garantem avanço *se alguém executar*. O que acontece se o
 * processo morreu segurando o lease, ou se um job ativo desapareceu? É pra
 * isso que existe este passo, rodado periodicamente pelo worker:
 *
 * 1. lease de saga vencido  → libera (outro executor pode assumir);
 * 2. job `running` com lease vencido → volta pra fila;
 * 3. saga em andamento SEM job ativo → enfileira o avanço de novo.
 *
 * O item 3 é a garantia de progresso: qualquer saga não terminal sempre
 * termina tendo um job na fila, mesmo depois de um crash no pior momento.
 */

import { createLogger } from "@/lib/logger";
import * as queue from "@/queue";
import { db } from "@/db";
import { findStaleSagas, releaseExpiredLeases } from "./orchestrator";
import { advanceDedupeKey, SAGA_ADVANCE_JOB } from "./runner";

const logger = createLogger("saga:reconcile");

export type ReconcileReport = {
  releasedSagaLeases: number;
  requeuedJobs: number;
  rescheduledSagas: number;
  deadJobs: number;
};

export async function reconcile(options: { now?: Date; limit?: number } = {}): Promise<ReconcileReport> {
  const now = options.now ?? new Date();

  const releasedSagaLeases = await releaseExpiredLeases(now);
  const requeuedJobs = await queue.requeueExpiredLeases({ now });

  let rescheduledSagas = 0;
  for (const saga of await findStaleSagas(now, options.limit ?? 50)) {
    const active = await queue.findActiveByDedupeKey(advanceDedupeKey(saga.id));
    if (active) continue;
    await queue.enqueue(db, {
      type: SAGA_ADVANCE_JOB,
      payload: { sagaId: saga.id },
      dedupeKey: advanceDedupeKey(saga.id),
      runAt: now,
    });
    rescheduledSagas += 1;
  }

  const deadJobs = await countDeadJobs();

  if (releasedSagaLeases + requeuedJobs + rescheduledSagas > 0) {
    logger.info("reconciliação aplicada", { releasedSagaLeases, requeuedJobs, rescheduledSagas, deadJobs });
  }

  return { releasedSagaLeases, requeuedJobs, rescheduledSagas, deadJobs };
}

async function countDeadJobs(): Promise<number> {
  const rows = await db.query.jobs.findMany({
    where: (job, { eq }) => eq(job.status, "dead"),
    columns: { id: true },
  });
  return rows.length;
}
