/**
 * Métricas de fila e saga: números exatos com horários controlados, e o
 * reflexo de checkouts de verdade (aprovado, recusado, instável).
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, sagaSteps, sagas } from "@/db/schema";
import * as queue from "@/queue";
import { getQueueMetrics } from "@/queue/metrics";
import { processOnce } from "@/queue/worker";
import { getSagaMetrics } from "@/saga/metrics";
import { advanceDedupeKey, runSagaInline } from "@/saga/runner";
import { startCheckout } from "../helpers/checkout";
import { closeDatabase, resetDatabase, seedCheckoutFixture } from "../helpers/db";

const NOW = new Date("2026-06-01T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const DAY = 24 * 60 * 60_000;

async function insertSaga(input: {
  status: "running" | "completed" | "compensated" | "failed";
  createdAt: Date;
  durationMs?: number;
  updatedAt?: Date;
  type?: string;
}): Promise<string> {
  const finishedAt = input.durationMs == null ? null : new Date(input.createdAt.getTime() + input.durationMs);
  const [row] = await db
    .insert(sagas)
    .values({
      type: input.type ?? "checkout",
      correlationId: `T-${Math.random()}`,
      status: input.status,
      payload: {},
      createdAt: input.createdAt,
      updatedAt: input.updatedAt ?? finishedAt ?? input.createdAt,
      finishedAt,
    })
    .returning({ id: sagas.id });
  return row.id;
}

after(closeDatabase);

describe("métricas da saga", () => {
  beforeEach(resetDatabase);

  it("taxa de conclusão e percentis contam só a janela e só as concluídas", async () => {
    for (const durationMs of [100, 200, 300, 400, 1_000]) {
      await insertSaga({ status: "completed", createdAt: ago(60_000), durationMs });
    }
    await insertSaga({ status: "compensated", createdAt: ago(60_000), durationMs: 50 });
    await insertSaga({ status: "completed", createdAt: ago(2 * DAY), durationMs: 99_999 }); // fora da janela
    await insertSaga({ status: "running", createdAt: ago(10_000) });

    const metrics = await getSagaMetrics(db, { since: ago(DAY), now: NOW });

    assert.equal(metrics.total, 7);
    assert.deepEqual(metrics.byStatus, { completed: 5, compensated: 1, running: 1 });
    assert.equal(metrics.completionRate, 5 / 6, "em andamento não entra no denominador");
    assert.equal(metrics.p50Ms, 300);
    assert.equal(metrics.p95Ms, 880, "percentil interpolado entre 400 e 1000");
  });

  it("sem saga terminada, a taxa é nula (não 0%)", async () => {
    await insertSaga({ status: "running", createdAt: ago(1_000) });
    const metrics = await getSagaMetrics(db, { since: ago(DAY), now: NOW });
    assert.equal(metrics.completionRate, null);
    assert.equal(metrics.p50Ms, null);
  });

  it("saga parada é a em andamento sem progresso há mais que o limite, de qualquer idade", async () => {
    await insertSaga({ status: "running", createdAt: ago(3 * DAY), updatedAt: ago(10 * 60_000) });
    await insertSaga({ status: "running", createdAt: ago(60_000), updatedAt: ago(30_000) });

    const metrics = await getSagaMetrics(db, { since: ago(DAY), now: NOW });
    assert.equal(metrics.stuck, 1);
  });

  it("filtra por tipo de saga", async () => {
    await insertSaga({ status: "completed", createdAt: ago(1_000), durationMs: 10 });
    await insertSaga({ status: "completed", createdAt: ago(1_000), durationMs: 10, type: "outra" });
    assert.equal((await getSagaMetrics(db, { since: ago(DAY), now: NOW, type: "checkout" })).total, 1);
  });

  it("por passo: execuções, retries, falhas e duração", async () => {
    const a = await insertSaga({ status: "completed", createdAt: ago(60_000), durationMs: 5_000 });
    const b = await insertSaga({ status: "compensated", createdAt: ago(60_000), durationMs: 5_000 });
    const step = (sagaId: string, name: string, position: number, status: "completed" | "compensated" | "failed", attempts: number, ms: number) => ({
      sagaId, name, position, status, attempts, startedAt: ago(50_000), finishedAt: new Date(ago(50_000).getTime() + ms),
    });
    await db.insert(sagaSteps).values([
      step(a, "reserve-stock", 0, "completed", 1, 100),
      step(a, "authorize-payment", 1, "completed", 2, 3_000),
      step(b, "reserve-stock", 0, "compensated", 2, 300), // ida + volta: não é retry
      step(b, "authorize-payment", 1, "failed", 1, 10),
    ]);

    const metrics = await getSagaMetrics(db, { since: ago(DAY), now: NOW });
    assert.deepEqual(
      metrics.steps.map((s) => [s.name, s.executions, s.succeeded, s.failed, s.retried]),
      [
        ["reserve-stock", 2, 2, 0, 0],
        ["authorize-payment", 2, 1, 1, 1],
      ],
    );
    assert.equal(metrics.steps[1].p50Ms, 3_000, "duração só dos concluídos (inclui a espera do retry)");
  });
});

describe("métricas da fila", () => {
  beforeEach(resetDatabase);

  it("conta por status e mede o job pronto mais antigo com o critério do claim", async () => {
    await queue.enqueue(db, { type: "x", runAt: ago(90_000) });
    await queue.enqueue(db, { type: "x", runAt: ago(5_000) });
    await queue.enqueue(db, { type: "x", runAt: new Date(NOW.getTime() + 60_000) }); // agendado pro futuro
    const [retry] = await db.insert(jobs).values({ type: "x", status: "failed", runAt: ago(120_000) }).returning();
    await db.insert(jobs).values({ type: "x", status: "dead", runAt: ago(DAY) });

    const metrics = await getQueueMetrics(db, { now: NOW });

    assert.deepEqual(metrics.byStatus, { queued: 3, failed: 1, dead: 1 });
    assert.equal(metrics.dead, 1);
    assert.equal(metrics.ready, 3, "2 queued vencidos + 1 aguardando retry vencido");
    assert.equal(metrics.oldestReadyAgeMs, 120_000, "o retry vencido é o mais antigo");

    await db.delete(jobs).where(eq(jobs.id, retry.id));
    assert.equal((await getQueueMetrics(db, { now: NOW })).oldestReadyAgeMs, 90_000);
  });

  it("fila vazia: sem atraso", async () => {
    const metrics = await getQueueMetrics(db, { now: NOW });
    assert.deepEqual(metrics, { byStatus: {}, dead: 0, ready: 0, oldestReadyAgeMs: 0 });
  });
});

describe("métricas refletem checkouts de verdade", () => {
  beforeEach(resetDatabase);

  it("aprovado, recusado e instável aparecem como conclusão, compensação e retry", async () => {
    const approved = await startCheckout(await seedCheckoutFixture());
    await runSagaInline(approved.sagaId);

    const declined = await startCheckout(await seedCheckoutFixture(), { simulate: "decline" });
    await runSagaInline(declined.sagaId);

    const flaky = await startCheckout(await seedCheckoutFixture(), { simulate: "flaky_once" });
    assert.equal((await runSagaInline(flaky.sagaId)).status, "retry");

    const pending = await queue.findActiveByDedupeKey(advanceDedupeKey(flaky.sagaId));
    assert.ok(pending);
    const during = await getQueueMetrics(db, { now: new Date(pending.runAt.getTime() + 1) });
    assert.equal(during.ready, 1, "o retry vencido conta como pronto");

    await db.update(jobs).set({ runAt: new Date() }).where(eq(jobs.id, pending.id));
    await processOnce({ workerId: "worker-de-teste" });

    const metrics = await getSagaMetrics(db, { since: new Date(Date.now() - DAY) });
    assert.deepEqual(metrics.byStatus, { completed: 2, compensated: 1 });
    assert.equal(metrics.completionRate, 2 / 3);
    assert.equal(metrics.stuck, 0);

    const payment = metrics.steps.find((s) => s.name === "authorize-payment");
    assert.deepEqual(
      payment && [payment.executions, payment.succeeded, payment.failed, payment.retried],
      [3, 2, 1, 1],
      "3 tentativas de pagamento: 2 passaram (uma no retry), 1 recusada",
    );
    assert.equal(metrics.steps[0].name, "reserve-stock", "passos na ordem da saga");
  });
});
