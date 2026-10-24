/**
 * Fluxo de sincronização: o que garante que nenhuma saga fica parada pra
 * sempre depois de um crash — mesmo que a mensagem dela tenha sumido do
 * caminho normal (DLQ, fila apagada).
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { ALL_QUEUES } from "@/composition/worker";
import { db } from "@/db";
import { outbox, sagas } from "@/db/schema";
import { purgeQueues } from "@/queue/broker";
import { reconcile } from "@/saga/reconcile";
import { runSagaInline } from "@/saga/runner";
import { settleSaga } from "../helpers/saga";
import { closeDatabase, resetDatabase, seedCheckoutFixture } from "../helpers/db";
import { startCheckout } from "../helpers/checkout";

beforeEach(resetDatabase);
after(closeDatabase);

const past = (ms: number) => new Date(Date.now() - ms);

/** Simula a mensagem perdida: some da outbox e do broker, e a saga parou há 2 min. */
async function loseMessages(sagaId: string) {
  await db.delete(outbox);
  await purgeQueues(ALL_QUEUES);
  await db.update(sagas).set({ updatedAt: past(120_000) }).where(eq(sagas.id, sagaId));
}

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
    assert.equal((await settleSaga(checkout.sagaId)).status, "completed");
  });

  it("não encosta em lease ainda válido", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1 });
    const checkout = await startCheckout(fixture);
    await loseMessages(checkout.sagaId);
    const leaseUntil = new Date(Date.now() + 60_000);

    await db.update(sagas).set({ lockedBy: "vivo", leaseUntil }).where(eq(sagas.id, checkout.sagaId));

    const report = await reconcile();
    assert.equal(report.releasedSagaLeases, 0);
    assert.equal(report.rescheduledSagas, 0, "saga em execução por outro não é reenfileirada");

    const saga = await db.query.sagas.findFirst({ where: eq(sagas.id, checkout.sagaId) });
    assert.equal(saga?.lockedBy, "vivo");
  });

  it("saga parada cuja mensagem sumiu ganha um avanço novo — e termina", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1 });
    const checkout = await startCheckout(fixture);
    await loseMessages(checkout.sagaId);

    const report = await reconcile();
    assert.equal(report.rescheduledSagas, 1);

    const [message] = await db.select().from(outbox);
    assert.equal(message.type, "saga.advance");
    assert.deepEqual(message.payload, { sagaId: checkout.sagaId });
    assert.equal((await settleSaga(checkout.sagaId, { inline: false })).status, "completed");
  });

  it("saga recente não é tocada: o avanço dela ainda está a caminho", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1 });
    await startCheckout(fixture);

    const report = await reconcile();
    assert.equal(report.rescheduledSagas, 0);
    assert.equal((await db.select().from(outbox)).length, 1, "só a mensagem original");
  });

  it("não reenfileira a mesma saga a cada ciclo", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1 });
    const checkout = await startCheckout(fixture);
    await loseMessages(checkout.sagaId);

    assert.equal((await reconcile()).rescheduledSagas, 1);
    assert.equal((await reconcile()).rescheduledSagas, 0, "o toque do 1º ciclo conta como progresso");
  });

  it("ignora sagas que já terminaram", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1 });
    const checkout = await startCheckout(fixture);
    assert.equal((await settleSaga(checkout.sagaId)).status, "completed");
    await loseMessages(checkout.sagaId);

    assert.equal((await reconcile()).rescheduledSagas, 0);
    assert.equal((await db.select().from(outbox)).length, 0);
  });

  it("não reenfileira saga que só está esperando a resposta de um passo remoto", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1 });
    const checkout = await startCheckout(fixture);
    assert.equal((await runSagaInline(checkout.sagaId)).status, "waiting");
    await db.update(sagas).set({ updatedAt: past(120_000) }).where(eq(sagas.id, checkout.sagaId));

    // Pagamentos fora do ar: o comando está na fila dele, a saga espera. Não é
    // saga parada — reenfileirar o avanço a cada 30 s só faria barulho.
    assert.equal((await reconcile()).rescheduledSagas, 0);
  });

  it("é seguro rodar com o banco vazio", async () => {
    assert.deepEqual(await reconcile(), { releasedSagaLeases: 0, rescheduledSagas: 0 });
  });
});
