import { cache } from "react";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { jobs, notifications, sagaSteps, sagas } from "@/db/schema";
import { computeAlerts, HEALTH_WINDOWS, type HealthWindow } from "@/lib/observability";
import { getQueueMetrics } from "@/queue/metrics";
import { getSagaMetrics } from "@/saga/metrics";

/**
 * Leituras do painel de orquestração (admin). Separado de `@/saga` de
 * propósito: aqui é só consulta pra tela, sem regra nenhuma.
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
    getQueueMetrics(db, { now }),
  ]);
  const alerts = computeAlerts(queueMetrics, {
    stuck: sagaMetrics.stuck,
    failed: sagaMetrics.byStatus.failed ?? 0,
  });
  return { window, sagas: sagaMetrics, queue: queueMetrics, alerts };
});

export const getJobsOverview = cache(async (limit = 25) => {
  return db.query.jobs.findMany({
    orderBy: [desc(jobs.createdAt)],
    limit,
  });
});

export const getActiveAndDeadJobs = cache(async (limit = 25) => {
  return db.query.jobs.findMany({
    where: inArray(jobs.status, ["queued", "running", "failed", "dead"]),
    orderBy: [asc(jobs.runAt)],
    limit,
  });
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
