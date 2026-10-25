/**
 * Reconciliação periódica: libera lease vencido e recria o avanço de saga
 * parada há mais de 1 min (a mensagem dela pode ter ido pra DLQ). Avanço a
 * mais é inofensivo — o lease e o log de passos ignoram o que já foi feito.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sagas } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { findStaleSagas, releaseExpiredLeases } from "./orchestrator";
import { enqueueAdvance } from "./runner";

const logger = createLogger("saga:reconcile");

export type ReconcileReport = {
  releasedSagaLeases: number;
  rescheduledSagas: number;
};

export async function reconcile(options: { now?: Date; limit?: number; idleMs?: number } = {}): Promise<ReconcileReport> {
  const now = options.now ?? new Date();

  const releasedSagaLeases = await releaseExpiredLeases(now);

  let rescheduledSagas = 0;
  for (const saga of await findStaleSagas(now, options.limit ?? 50, options.idleMs)) {
    // Marca o toque junto: a mesma saga não é reenfileirada a cada ciclo
    // enquanto o avanço novo ainda está a caminho.
    await db.transaction(async (tx) => {
      await enqueueAdvance(tx, saga.id);
      await tx.update(sagas).set({ updatedAt: now }).where(eq(sagas.id, saga.id));
    });
    rescheduledSagas += 1;
  }

  if (releasedSagaLeases + rescheduledSagas > 0) {
    logger.info("reconciliação aplicada", { releasedSagaLeases, rescheduledSagas });
  }

  return { releasedSagaLeases, rescheduledSagas };
}
