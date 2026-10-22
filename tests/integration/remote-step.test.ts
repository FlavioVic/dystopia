/**
 * Passo remoto (pagamentos em processo próprio): o que a troca de chamada
 * direta por mensagem introduz — outbox do comando, resposta repetida,
 * serviço fora do ar, estorno por mensagem e resposta chegando com a saga
 * ocupada por outro executor.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, orders, payments, products, sagas } from "@/db/schema";
import { sendReply, readReplyTo } from "@/queue/reply";
import { SAGA_REPLY_JOB } from "@/saga/messaging";
import { advanceSaga, getSagaWithSteps } from "@/saga/orchestrator";
import { runSagaInline } from "@/saga/runner";
import { PAYMENT_AUTHORIZE, PAYMENT_REFUND, PAYMENTS_QUEUE } from "@/services/payments/contract";
import { startCheckout } from "../helpers/checkout";
import { closeDatabase, resetDatabase, seedCheckoutFixture } from "../helpers/db";
import { fastForwardJobs, settleSaga, work } from "../helpers/saga";

beforeEach(resetDatabase);
after(closeDatabase);

async function stockOf(productId: string): Promise<number> {
  const product = await db.query.products.findFirst({ where: eq(products.id, productId) });
  return product?.stockQuantity ?? -1;
}

async function step(sagaId: string, name: string) {
  return (await getSagaWithSteps(sagaId))?.steps.find((row) => row.name === name);
}

async function commands(type: string) {
  return db.query.jobs.findMany({ where: and(eq(jobs.queue, PAYMENTS_QUEUE), eq(jobs.type, type)) });
}

/** Leva o checkout com cupom esgotado até a saga estar esperando o estorno. */
async function untilRefundRequested() {
  const fixture = await seedCheckoutFixture({
    stock: 4,
    quantity: 1,
    priceCents: 20_000,
    coupon: { discountType: "fixed", discountValue: 5_000, maxUsage: 1, usageCount: 1 },
  });
  const checkout = await startCheckout(fixture, { useCoupon: true });
  assert.equal((await runSagaInline(checkout.sagaId)).status, "waiting");
  await work("payments"); // cobra e responde
  await work("default"); // aplica a resposta; o cupom falha; pede o estorno
  return { fixture, checkout };
}

describe("passo remoto — envio", () => {
  it("o comando nasce com o passo `waiting`, com endereço de resposta, e não duplica", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1 });
    const checkout = await startCheckout(fixture);

    assert.deepEqual(await runSagaInline(checkout.sagaId), { status: "waiting", step: "authorize-payment" });
    assert.equal((await step(checkout.sagaId, "authorize-payment"))?.status, "waiting");

    const [command] = await commands(PAYMENT_AUTHORIZE);
    assert.ok(command, "comando na fila de pagamentos");
    const replyTo = readReplyTo(command.payload as Record<string, unknown>);
    assert.equal(replyTo?.type, SAGA_REPLY_JOB);
    assert.deepEqual(replyTo?.payload, { sagaId: checkout.sagaId, step: "authorize-payment", phase: "invoke" });

    // Avançar de novo enquanto espera não reenvia nada.
    assert.deepEqual(await advanceSaga(checkout.sagaId), { status: "waiting", step: "authorize-payment" });
    assert.equal((await commands(PAYMENT_AUTHORIZE)).length, 1);

    const saga = await db.query.sagas.findFirst({ where: eq(sagas.id, checkout.sagaId) });
    assert.equal(saga?.lockedBy, null, "esperando, a saga não segura lease");
  });
});

describe("passo remoto — resposta", () => {
  it("resposta repetida (entrega pelo menos uma vez) não aplica duas vezes", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1 });
    const checkout = await startCheckout(fixture);
    assert.equal((await settleSaga(checkout.sagaId)).status, "completed");

    const original = await db.query.jobs.findFirst({ where: eq(jobs.type, SAGA_REPLY_JOB) });
    assert.ok(original);
    await db.insert(jobs).values({ type: SAGA_REPLY_JOB, payload: original.payload });

    assert.equal((await work("default")).claimed, 1);
    const saga = await db.query.sagas.findFirst({ where: eq(sagas.id, checkout.sagaId) });
    assert.equal(saga?.status, "completed");
    assert.equal((await db.query.payments.findMany({ where: eq(payments.orderId, checkout.orderId) })).length, 1);
    assert.equal(await stockOf(fixture.product.id), 4, "nada aplicado de novo");
  });

  it("pagamentos fora do ar: a saga espera sem gastar nada e conclui quando o processo volta", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1 });
    const checkout = await startCheckout(fixture);
    assert.equal((await runSagaInline(checkout.sagaId)).status, "waiting");

    // Só o worker da saga está de pé: não há o que ele fazer.
    for (let i = 0; i < 3; i += 1) assert.equal((await work("default")).claimed, 0);
    const order = await db.query.orders.findFirst({ where: eq(orders.id, checkout.orderId) });
    assert.equal(order?.status, "pending");
    assert.equal(await stockOf(fixture.product.id), 4, "estoque segue reservado enquanto espera");

    // O processo de pagamentos volta.
    assert.equal((await settleSaga(checkout.sagaId, { inline: false })).status, "completed");
  });

  it("resposta que chega com a saga ocupada volta pra fila em vez de se perder", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1 });
    const checkout = await startCheckout(fixture);
    assert.equal((await runSagaInline(checkout.sagaId)).status, "waiting");
    await work("payments");

    await db
      .update(sagas)
      .set({ lockedBy: "outro-executor", leaseUntil: new Date(Date.now() + 60_000) })
      .where(eq(sagas.id, checkout.sagaId));

    assert.equal((await work("default")).claimed, 1);
    const reply = await db.query.jobs.findFirst({ where: eq(jobs.type, SAGA_REPLY_JOB) });
    assert.equal(reply?.status, "queued", "a resposta volta pra fila");
    assert.equal((await step(checkout.sagaId, "authorize-payment"))?.status, "completed", "mas já foi aplicada");

    // O outro executor sai; a resposta reprocessada acorda a saga.
    await db.update(sagas).set({ lockedBy: null, leaseUntil: null }).where(eq(sagas.id, checkout.sagaId));
    await fastForwardJobs();
    assert.equal((await settleSaga(checkout.sagaId, { inline: false })).status, "completed");
  });
});

describe("passo remoto — compensação", () => {
  it("o estorno também é comando: o estoque só volta depois da resposta do estorno", async () => {
    const { fixture, checkout } = await untilRefundRequested();

    const saga = await db.query.sagas.findFirst({ where: eq(sagas.id, checkout.sagaId) });
    assert.equal(saga?.status, "compensating");
    assert.equal((await step(checkout.sagaId, "authorize-payment"))?.status, "waiting");
    assert.equal((await commands(PAYMENT_REFUND)).length, 1, "pedido de estorno enviado");
    assert.equal(await stockOf(fixture.product.id), 3, "desfaz em ordem: estoque ainda não voltou");
    const [payment] = await db.query.payments.findMany({ where: eq(payments.orderId, checkout.orderId) });
    assert.equal(payment.status, "paid");

    const done = await settleSaga(checkout.sagaId, { inline: false });
    assert.equal(done.status, "compensated");
    assert.equal(await stockOf(fixture.product.id), 4);
    const [refunded] = await db.query.payments.findMany({ where: eq(payments.orderId, checkout.orderId) });
    assert.equal(refunded.status, "refunded");
    assert.equal((await step(checkout.sagaId, "authorize-payment"))?.status, "compensated");
  });

  it("estorno que falha de vez para a saga em `failed` (intervenção manual)", async () => {
    const { fixture, checkout } = await untilRefundRequested();

    // O processo de pagamentos desistiu do estorno: responde com falha.
    const [refund] = await commands(PAYMENT_REFUND);
    const replyTo = readReplyTo(refund.payload as Record<string, unknown>);
    assert.ok(replyTo);
    await db.delete(jobs).where(eq(jobs.id, refund.id));
    await sendReply(db, replyTo, { ok: false, code: "gateway_unavailable", message: "Provedor fora.", attempts: 3 });

    await work("default");
    const saga = await db.query.sagas.findFirst({ where: eq(sagas.id, checkout.sagaId) });
    assert.equal(saga?.status, "failed");
    assert.match(saga?.lastError ?? "", /compensação de authorize-payment falhou/);
    assert.equal(await stockOf(fixture.product.id), 3, "para onde falhou: nada desfeito por cima");
  });
});
