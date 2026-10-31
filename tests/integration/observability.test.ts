/**
 * Métricas de fila e saga: números exatos com horários controlados, e o
 * reflexo de checkouts de verdade (aprovado, recusado, instável).
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { db } from "@/db";
import { outbox, sagaSteps, sagas } from "@/db/schema";
import * as queue from "@/queue";
import { relayOutbox } from "@/queue/relay";
import { getQueueMetrics } from "@/queue/metrics";
import { getSagaMetrics } from "@/saga/metrics";
import { runSagaInline } from "@/saga/runner";
import { PAYMENTS_QUEUE } from "@/services/payments/contract";
import { startCheckout } from "../helpers/checkout";
import { closeBroker, purgeQueues } from "@/queue/broker";
import { closeDatabase, resetDatabase, seedCheckoutFixture } from "../helpers/db";
import { settleSaga, work } from "../helpers/saga";

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
  beforeEach(async () => {
    await resetDatabase();
    await purgeQueues(["metricas"]);
  });

  it("outbox: conta o que falta publicar e mede o mais antigo", async () => {
    await queue.enqueue(db, { type: "x", queue: "metricas" });
    await db.insert(outbox).values({ type: "x", queue: "metricas", createdAt: ago(90_000) });
    await db
      .insert(outbox)
      .values({ type: "x", queue: "metricas", createdAt: ago(120_000), publishAttempts: 2, lastError: "broker fora" });
    await db.insert(outbox).values({ type: "x", queue: "metricas", createdAt: ago(DAY), publishedAt: ago(DAY) });

    const metrics = await getQueueMetrics(db, { queues: ["metricas"], now: NOW });
    assert.equal(metrics.outbox.pending, 3, "publicada não conta");
    assert.equal(metrics.outbox.failing, 1);
    assert.equal(metrics.outbox.oldestPendingAgeMs, 120_000);
  });

  it("broker: pronta, em espera e DLQ, por fila", async () => {
    await queue.enqueue(db, { type: "x", queue: "metricas" });
    await queue.enqueue(db, { type: "x", queue: "metricas", delayMs: 400 });
    await relayOutbox(db);

    const metrics = await getQueueMetrics(db, { queues: ["metricas"], now: NOW });
    assert.equal(metrics.broker.status, "up");
    assert.deepEqual(
      metrics.queues.map(({ queue: name, ready, retrying, dead }) => ({ name, ready, retrying, dead })),
      [{ name: "metricas", ready: 1, retrying: 1, dead: 0 }],
    );
    assert.deepEqual([metrics.ready, metrics.retrying, metrics.dead, metrics.outbox.pending], [1, 1, 0, 0]);
  });

  it("broker inacessível não derruba a leitura: vira status", async () => {
    const realUrl = process.env.RABBITMQ_URL;
    await closeBroker();
    process.env.RABBITMQ_URL = "amqp://ninguem:nada@127.0.0.1:1";
    try {
      const metrics = await getQueueMetrics(db, { queues: ["metricas"], now: NOW });
      assert.equal(metrics.broker.status, "down");
      assert.deepEqual(metrics.queues, []);
    } finally {
      await closeBroker();
      if (realUrl === undefined) delete process.env.RABBITMQ_URL;
      else process.env.RABBITMQ_URL = realUrl;
    }
  });
});

describe("métricas refletem checkouts de verdade", () => {
  beforeEach(resetDatabase);

  it("aprovado, recusado e instável aparecem como conclusão, compensação e retry", async () => {
    const approved = await startCheckout(await seedCheckoutFixture());
    await settleSaga(approved.sagaId);

    const declined = await startCheckout(await seedCheckoutFixture(), { simulate: "decline" });
    await settleSaga(declined.sagaId);

    const flaky = await startCheckout(await seedCheckoutFixture(), { simulate: "flaky_once" });
    assert.equal((await runSagaInline(flaky.sagaId)).status, "waiting");
    await work("payments"); // 1ª tentativa falha: o comando vai para a fila de espera

    const during = await getQueueMetrics(db, { queues: [PAYMENTS_QUEUE] });
    assert.equal(during.retrying, 1, "o comando do pedido instável aguarda nova tentativa");

    await settleSaga(flaky.sagaId, { inline: false });

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
