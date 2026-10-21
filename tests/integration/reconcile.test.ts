/**
 * Fluxo de sincronização: o que garante que nenhuma saga fica parada pra
 * sempre depois de um crash.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, sagas } from "@/db/schema";
import * as queue from "@/queue";
import { reconcile } from "@/saga/reconcile";
import { advanceDedupeKey, runSagaInline } from "@/saga/runner";
import { closeDatabase, resetDatabase, seedCheckoutFixture } from "../helpers/db";
import { startCheckout } from "../helpers/checkout";

beforeEach(resetDatabase);
after(closeDatabase);

const past = (ms: number) => new Date(Date.now() - ms);

describe("reconciliação", () => {
  it("libera lease de saga abandonado por worker morto", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1 });
    const checkout = await startCheckout(fixture);

    await db
      .update(sagas)
      .set({ lockedBy: "worker-morto", leaseUntil: past(60_000) })
      .where(eq(sagas.id, checkout.sagaId));

    const report = await reconcile();
    assert.equal(report.releasedSagaLeases, 1);

    const saga = await db.query.sagas.findFirst({ where: eq(sagas.id, checkout.sagaId) });
    assert.equal(saga?.lockedBy, null);
    assert.equal(saga?.leaseUntil, null);

    // Depois de liberado, qualquer executor consegue terminar o pedido.
    assert.equal((await runSagaInline(checkout.sagaId)).status, "completed");
  });

  it("não encosta em lease ainda válido", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1 });
    const checkout = await startCheckout(fixture);
    const leaseUntil = new Date(Date.now() + 60_000);

    await db.update(sagas).set({ lockedBy: "vivo", leaseUntil }).where(eq(sagas.id, checkout.sagaId));

    const report = await reconcile();
    assert.equal(report.releasedSagaLeases, 0);
    assert.equal(report.rescheduledSagas, 0, "saga em execução por outro não é reenfileirada");

    const saga = await db.query.sagas.findFirst({ where: eq(sagas.id, checkout.sagaId) });
    assert.equal(saga?.lockedBy, "vivo");
  });

  it("reenfileira saga em andamento que ficou sem job", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1 });
    const checkout = await startCheckout(fixture);

    // Cenário de crash: o job desapareceu (processo matou a linha) e ninguém
    // mais ia tocar nessa saga.
    await db.delete(jobs);
    assert.equal(await queue.findActiveByDedupeKey(advanceDedupeKey(checkout.sagaId)), undefined);

    const report = await reconcile();
    assert.equal(report.rescheduledSagas, 1);

    const job = await queue.findActiveByDedupeKey(advanceDedupeKey(checkout.sagaId));
    assert.ok(job, "a saga volta a ter job");
    assert.equal(job.type, "saga.advance");
    assert.deepEqual(job.payload, { sagaId: checkout.sagaId });
  });

  it("não duplica job de saga que já tem um ativo", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1 });
    await startCheckout(fixture);

    const report = await reconcile();
    assert.equal(report.rescheduledSagas, 0);
    assert.equal((await db.query.jobs.findMany()).length, 1);
  });

  it("ignora sagas que já terminaram", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1 });
    const checkout = await startCheckout(fixture);
    assert.equal((await runSagaInline(checkout.sagaId)).status, "completed");
    await db.delete(jobs);

    const report = await reconcile();
    assert.equal(report.rescheduledSagas, 0);
    assert.equal((await db.query.jobs.findMany()).length, 0);
  });

  it("devolve pra fila job travado e conta a dead-letter", async () => {
    const enqueued = await queue.enqueue(db, { type: "teste.job", maxAttempts: 1 });
    await queue.claim({ workerId: "w1", leaseMs: 1_000 });
    await db.update(jobs).set({ leaseUntil: past(10_000) }).where(eq(jobs.id, enqueued!.id));

    const morto = await queue.enqueue(db, { type: "teste.job", maxAttempts: 1 });
    await queue.claim({ workerId: "w1" });
    await queue.fail(morto!.id, "fatal");

    const report = await reconcile();
    assert.equal(report.requeuedJobs, 1);
    assert.equal(report.deadJobs, 1);
  });

  it("é seguro rodar com o banco vazio", async () => {
    assert.deepEqual(await reconcile(), {
      releasedSagaLeases: 0,
      requeuedJobs: 0,
      rescheduledSagas: 0,
      deadJobs: 0,
    });
  });
});
