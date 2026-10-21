import { cache } from "react";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { jobs, notifications, sagaSteps, sagas } from "@/db/schema";

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

export const getSagaStats = cache(async () => {
  const rows = await db.select({ status: sagas.status }).from(sagas);
  const byStatus = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
  return { total: rows.length, byStatus };
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

export const getJobStats = cache(async () => {
  const rows = await db.select({ status: jobs.status }).from(jobs);
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
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
