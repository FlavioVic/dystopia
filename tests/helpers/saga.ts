/**
 * Roda uma saga como produção roda: os consumidores do RabbitMQ — `saga`,
 * `payments` (processo de pagamentos) e `notifications` — até ela terminar.
 * Por padrão dá um primeiro avanço direto (`runSagaInline`), que é o que o
 * primeiro consumidor faria.
 *
 * Nada de relógio adiantado: o retry passa de verdade pelas filas de espera
 * do broker, só que com TTL de milissegundos (o runner configura). O backoff
 * de passo da saga (lease segurado até o retry) é real também: ~1 s.
 */

import { eq, isNull } from "drizzle-orm";
import { ALL_OUTBOXES, ALL_QUEUES } from "@/composition/worker";
import { db } from "@/db";
import { outbox, sagas } from "@/db/schema";
import { paymentsDb } from "@/services/payments/db";
import { queueDepths } from "@/queue/broker";
import { sagaHandlers } from "@/queue/handlers";
import { drainQueues, type DrainReport } from "@/queue/worker";
import { SAGA_QUEUE } from "@/saga/messaging";
import { runSagaInline } from "@/saga/runner";
import { createNotificationHandlers } from "@/services/notifications/delivery";
import { NOTIFICATIONS_QUEUE } from "@/services/notifications";
import { paymentHandlers } from "@/services/payments/consumer";
import { PAYMENTS_QUEUE } from "@/services/payments/contract";

// Entrega de e-mail sempre simulada nos testes — mesmo com RESEND_API_KEY no .env.
export const testHandlers = {
  ...sagaHandlers,
  ...paymentHandlers,
  ...createNotificationHandlers({ email: null, fetch: () => Promise.reject(new Error("rede proibida em teste")) }),
};

export type SagaRow = typeof sagas.$inferSelect;

/** Onde a saga para sozinha (`halted` só sai com retomada). */
const TERMINAL = ["completed", "compensated", "failed", "halted"];

const QUEUES = { saga: SAGA_QUEUE, payments: PAYMENTS_QUEUE, notifications: NOTIFICATIONS_QUEUE } as const;

/**
 * Publica a outbox e consome o que estiver PRONTO numa fila (ou em todas),
 * sem esperar retry. Devolve o que aconteceu.
 */
export async function work(queue: keyof typeof QUEUES | "all" = "all"): Promise<DrainReport> {
  const queues = queue === "all" ? ALL_QUEUES : [QUEUES[queue]];
  return drainQueues({ queues, handlers: testHandlers, budgetMs: 5_000, outboxes: ALL_OUTBOXES });
}

/** Espera as mensagens das filas de espera (retry) voltarem para a fila de trabalho. */
export async function waitForRetries(timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const waiting = (await queueDepths(ALL_QUEUES)).reduce((sum, depth) => sum + depth.retrying, 0);
    if (waiting === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("mensagens presas nas filas de espera");
}

export async function settleSaga(sagaId: string, options: { inline?: boolean; timeoutMs?: number } = {}): Promise<SagaRow> {
  if (options.inline !== false) await runSagaInline(sagaId);

  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  while (Date.now() < deadline) {
    const saga = await db.query.sagas.findFirst({ where: eq(sagas.id, sagaId) });
    if (!saga) throw new Error(`saga ${sagaId} sumiu`);
    if (TERMINAL.includes(saga.status)) return saga;

    const report = await work("all");
    if (report.received === 0) await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`saga ${sagaId} não terminou — consumidores parados ou passo esperando para sempre`);
}

/** Código de erro gravado em `lastError` ("payment_declined: ..."). */
export function lastErrorCode(saga: SagaRow): string | null {
  return saga.lastError?.split(":")[0] ?? null;
}

/** O que ainda falta fazer em algum lugar: outbox não publicada e filas do broker. */
export async function pendingWork(): Promise<{ outbox: number; ready: number; retrying: number; dead: number }> {
  const depths = await queueDepths(ALL_QUEUES);
  const sum = (key: "ready" | "retrying" | "dead") => depths.reduce((total, depth) => total + depth[key], 0);
  // As duas caixas de saída: a da loja e a de pagamentos (banco próprio).
  const unpublished = (
    await Promise.all(
      [db, paymentsDb].map((database) => database.select({ id: outbox.id }).from(outbox).where(isNull(outbox.publishedAt))),
    )
  ).flat();
  return { outbox: unpublished.length, ready: sum("ready"), retrying: sum("retrying"), dead: sum("dead") };
}

export const IDLE = { outbox: 0, ready: 0, retrying: 0, dead: 0 };
