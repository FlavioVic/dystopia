import { cache } from "react";
import { asc, desc, eq } from "drizzle-orm";
import { ALL_OUTBOXES, ALL_QUEUES } from "@/composition/worker";
import { db } from "@/db";
import { notifications, sagaSteps, sagas } from "@/db/schema";
import { computeAlerts, HEALTH_WINDOWS, type HealthWindow } from "@/lib/observability";
import { peekDeadLetters, type DeadLetter } from "@/queue/dead-letters";
import { getQueueMetrics } from "@/queue/metrics";
import { getSagaMetrics } from "@/saga/metrics";

/**
 * Leituras do painel de orquestração (admin). Separado de `@/saga` de
 * propósito: aqui é só consulta para a tela, sem regra nenhuma.
 */

export const getSagasOverview = cache(async (limit = 20) => {
  return db.query.sagas.findMany({
    orderBy: [desc(sagas.createdAt)],
    limit,
    with: { steps: { orderBy: [asc(sagaSteps.position)] } },
  });
});

/**
 * Saúde da operação numa janela: métricas de saga e fila + alertas. Usado pelo
 * painel de orquestração e pela faixa de alerta do layout do admin (o cache()
 * faz os dois dividirem a mesma leitura no request).
 */
export const getOperationalHealth = cache(async (window: HealthWindow = "24h") => {
  const now = new Date();
  const [sagaMetrics, queueMetrics] = await Promise.all([
    getSagaMetrics(db, { since: new Date(now.getTime() - HEALTH_WINDOWS[window].ms), now }),
    getQueueMetrics(db, { queues: ALL_QUEUES, now, outboxes: ALL_OUTBOXES }),
  ]);
  const alerts = computeAlerts(queueMetrics, {
    stuck: sagaMetrics.stuck,
    overdueRemote: sagaMetrics.overdueRemote,
    failed: sagaMetrics.byStatus.failed ?? 0,
    halted: sagaMetrics.byStatus.halted ?? 0,
  });
  return { window, sagas: sagaMetrics, queue: queueMetrics, alerts };
});

/**
 * O que está na DLQ de cada fila (sem consumir). Só olha as filas que têm
 * mensagem lá — `queues` vem das métricas, que já contaram.
 */
export const getDeadLetters = cache(async (queues: string[], limit = 20): Promise<DeadLetter[]> => {
  const letters: DeadLetter[] = [];
  for (const queue of queues) {
    if (letters.length >= limit) break;
    letters.push(...(await peekDeadLetters(queue, limit - letters.length)));
  }
  return letters;
});

export const getRecentNotifications = cache(async (limit = 10) => {
  return db.query.notifications.findMany({
    orderBy: [desc(notifications.createdAt)],
    limit,
  });
});

export const getSagaForOrder = cache(async (orderNumber: string) => {
  return db.query.sagas.findFirst({
    where: eq(sagas.correlationId, orderNumber),
    orderBy: [desc(sagas.createdAt)],
    with: { steps: { orderBy: [asc(sagaSteps.position)] } },
  });
});
