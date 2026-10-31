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
import { orders, outbox, payments, products, sagas } from "@/db/schema";
import { enqueue } from "@/queue";
import { purgeQueues, queueDepths } from "@/queue/broker";
import { sendReply, readReplyTo } from "@/queue/reply";
import { SAGA_QUEUE, SAGA_REPLY } from "@/saga/messaging";
import { advanceSaga, getSagaWithSteps } from "@/saga/orchestrator";
import { runSagaInline } from "@/saga/runner";
import { PAYMENT_AUTHORIZE, PAYMENT_REFUND, PAYMENTS_QUEUE } from "@/services/payments/contract";
import { startCheckout } from "../helpers/checkout";
import { closeDatabase, resetDatabase, seedCheckoutFixture } from "../helpers/db";
import { settleSaga, waitForRetries, work } from "../helpers/saga";

beforeEach(resetDatabase);
after(closeDatabase);

async function stockOf(productId: string): Promise<number> {
  const product = await db.query.products.findFirst({ where: eq(products.id, productId) });
  return product?.stockQuantity ?? -1;
}

async function step(sagaId: string, name: string) {
  return (await getSagaWithSteps(sagaId))?.steps.find((row) => row.name === name);
}

/** Comandos gravados para a fila de pagamentos (outbox). */
async function commands(type: string) {
  return db.query.outbox.findMany({ where: and(eq(outbox.queue, PAYMENTS_QUEUE), eq(outbox.type, type)) });
}

/**
 * Leva o checkout com cupom esgotado até a saga estar esperando o estorno.
 * Só existe na v1 da saga (cobrança antes do cupom, tudo compensável): na v2
 * a cobrança é o pivô e nunca é desfeita — mas o mecanismo de compensação
 * remota do orquestrador continua valendo para quem tiver passo assim.
 */
async function untilRefundRequested() {
  const fixture = await seedCheckoutFixture({
    stock: 4,
    quantity: 1,
    priceCents: 20_000,
    coupon: { discountType: "fixed", discountValue: 5_000, maxUsage: 1, usageCount: 1 },
  });
  const checkout = await startCheckout(fixture, { useCoupon: true, definitionVersion: 1 });
  assert.equal((await runSagaInline(checkout.sagaId)).status, "waiting");
  await work("payments"); // cobra e responde
  await work("saga"); // aplica a resposta; o cupom falha; pede o estorno
  return { fixture, checkout };
}

describe("passo remoto — envio", () => {
  it("o comando nasce com o passo `waiting`, com endereço de resposta, e não duplica", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1 });
    const checkout = await startCheckout(fixture);

    assert.deepEqual(await runSagaInline(checkout.sagaId), { status: "waiting", step: "authorize-payment" });
    assert.equal((await step(checkout.sagaId, "authorize-payment"))?.status, "waiting");

    const [command] = await commands(PAYMENT_AUTHORIZE);
    assert.ok(command, "comando gravado para a fila de pagamentos, na transação do passo");
    const replyTo = readReplyTo(command.payload as Record<string, unknown>);
    assert.equal(replyTo?.type, SAGA_REPLY);
    assert.equal(replyTo?.queue, SAGA_QUEUE);
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

    // Reentrega da mesma resposta (broker reentrega o que ficou sem ack).
    const original = await db.query.outbox.findFirst({ where: eq(outbox.type, SAGA_REPLY) });
    assert.ok(original);
    await enqueue(db, { type: SAGA_REPLY, queue: SAGA_QUEUE, payload: original.payload as Record<string, unknown> });

    assert.deepEqual(await work("saga"), { received: 1, acked: 1, retried: 0, dead: 0 });
    const saga = await db.query.sagas.findFirst({ where: eq(sagas.id, checkout.sagaId) });
    assert.equal(saga?.status, "completed");
    assert.equal((await db.query.payments.findMany({ where: eq(payments.orderId, checkout.orderId) })).length, 1);
    assert.equal(await stockOf(fixture.product.id), 4, "nada aplicado de novo");
  });

  it("pagamentos fora do ar: a saga espera sem gastar nada e conclui quando o processo volta", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1 });
    const checkout = await startCheckout(fixture);
    assert.equal((await runSagaInline(checkout.sagaId)).status, "waiting");

    // Só o consumidor da saga está de pé: ele pega o avanço original (que só
    // confirma o `waiting`) e depois não há o que fazer — o comando fica
    // parado na fila `payments`, sem consumidor, sem se perder.
    assert.equal((await work("saga")).received, 1);
    for (let i = 0; i < 3; i += 1) assert.equal((await work("saga")).received, 0);
    const [paymentsQueue] = await queueDepths([PAYMENTS_QUEUE]);
    assert.equal(paymentsQueue.ready, 1, "comando esperando o processo de pagamentos");
    const order = await db.query.orders.findFirst({ where: eq(orders.id, checkout.orderId) });
    assert.equal(order?.status, "pending");
    assert.equal(await stockOf(fixture.product.id), 4, "estoque segue reservado enquanto espera");

    // O processo de pagamentos volta.
    assert.equal((await settleSaga(checkout.sagaId, { inline: false })).status, "completed");
  });

  it("resposta que chega com a saga ocupada volta para a fila em vez de se perder", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1 });
    const checkout = await startCheckout(fixture);
    assert.equal((await runSagaInline(checkout.sagaId)).status, "waiting");
    await work("payments");

    await db
      .update(sagas)
      .set({ lockedBy: "outro-executor", leaseUntil: new Date(Date.now() + 60_000) })
      .where(eq(sagas.id, checkout.sagaId));

    const report = await work("saga");
    assert.equal(report.dead, 0);
    assert.ok(report.retried >= 1, "a resposta volta para a fila de espera em vez de ser descartada");
    const [sagaQueue] = await queueDepths([SAGA_QUEUE]);
    assert.ok(sagaQueue.retrying >= 1);
    assert.equal((await step(checkout.sagaId, "authorize-payment"))?.status, "completed", "mas já foi aplicada");

    // O outro executor sai; a resposta reprocessada acorda a saga.
    await db.update(sagas).set({ lockedBy: null, leaseUntil: null }).where(eq(sagas.id, checkout.sagaId));
    await waitForRetries();
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
    await purgeQueues([PAYMENTS_QUEUE]);
    await sendReply(db, replyTo, { ok: false, code: "gateway_unavailable", message: "Provedor fora.", attempts: 3 });

    await work("saga");
    const saga = await db.query.sagas.findFirst({ where: eq(sagas.id, checkout.sagaId) });
    assert.equal(saga?.status, "failed");
    assert.match(saga?.lastError ?? "", /compensação de authorize-payment falhou/);
    assert.equal(await stockOf(fixture.product.id), 3, "para onde falhou: nada desfeito por cima");
  });
});
