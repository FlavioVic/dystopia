/**
 * Roda uma saga como produção roda: o avanço no request (inline) e depois os
 * workers das duas filas — `default` (saga) e `payments` (processo de
 * pagamentos) — até ela terminar.
 *
 * Adianta o relógio dos jobs agendados (backoff) pra o teste não esperar.
 */

import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { jobs, sagas } from "@/db/schema";
import { DEFAULT_QUEUE } from "@/queue";
import { processOnce, type TickReport } from "@/queue/worker";
import { runSagaInline } from "@/saga/runner";
import { PAYMENTS_QUEUE } from "@/services/payments/contract";
import { createNotificationHandlers } from "@/services/notifications/delivery";
import { paymentHandlers } from "@/services/payments/consumer";

// Entrega de e-mail sempre simulada nos testes — mesmo com RESEND_API_KEY no .env.
const handlers = {
  ...paymentHandlers,
  ...createNotificationHandlers({ email: null, fetch: () => Promise.reject(new Error("rede proibida em teste")) }),
};

export type SagaRow = typeof sagas.$inferSelect;

const TERMINAL = ["completed", "compensated", "failed"];

/** Um tick de worker numa fila (ou nas duas), com os handlers de pagamento. */
export async function work(queue: "default" | "payments" | "all" = "all"): Promise<TickReport> {
  const queues = queue === "all" ? [DEFAULT_QUEUE, PAYMENTS_QUEUE] : [queue === "default" ? DEFAULT_QUEUE : PAYMENTS_QUEUE];
  return processOnce({ workerId: "worker-de-teste", queues, handlers, batchSize: 10 });
}

/** Faz os jobs agendados pro futuro (backoff) ficarem prontos agora. */
export async function fastForwardJobs(): Promise<void> {
  await db.update(jobs).set({ runAt: new Date() }).where(inArray(jobs.status, ["queued", "failed"]));
}

export async function settleSaga(sagaId: string, options: { inline?: boolean; maxTicks?: number } = {}): Promise<SagaRow> {
  if (options.inline !== false) await runSagaInline(sagaId);

  for (let tick = 0; tick < (options.maxTicks ?? 40); tick += 1) {
    const saga = await db.query.sagas.findFirst({ where: eq(sagas.id, sagaId) });
    if (!saga) throw new Error(`saga ${sagaId} sumiu`);
    if (TERMINAL.includes(saga.status)) return saga;

    await fastForwardJobs();
    await work("all");
  }

  throw new Error(`saga ${sagaId} não terminou — workers parados ou passo esperando pra sempre`);
}

/** Código de erro gravado em `lastError` ("payment_declined: ..."). */
export function lastErrorCode(saga: SagaRow): string | null {
  return saga.lastError?.split(":")[0] ?? null;
}
