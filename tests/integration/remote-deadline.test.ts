/**
 * Prazo do passo remoto: comando que morreu no caminho, resposta que se
 * perdeu, serviço que não responde. Sem prazo, a saga esperaria para sempre;
 * com ele, a reconciliação pergunta o status (`payments.status`) e a resposta
 * da consulta decide — concluir, reenviar ou esperar mais.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, outbox, payments } from "@/db/schema";
import { purgeQueues } from "@/queue/broker";
import { relayOutbox } from "@/queue/relay";
import { PAYMENT_REPLY_TIMEOUT_MS } from "@/saga/definitions/checkout";
import { SAGA_QUEUE } from "@/saga/messaging";
import { getSagaMetrics } from "@/saga/metrics";
import { getSagaWithSteps } from "@/saga/orchestrator";
import { reconcile } from "@/saga/reconcile";
import { runSagaInline } from "@/saga/runner";
import { PAYMENT_AUTHORIZE, PAYMENT_STATUS, PAYMENTS_QUEUE } from "@/services/payments/contract";
import { startCheckout } from "../helpers/checkout";
import { closeDatabase, resetDatabase, seedCheckoutFixture } from "../helpers/db";
import { settleSaga, work } from "../helpers/saga";

beforeEach(resetDatabase);
after(closeDatabase);

const later = (ms: number) => new Date(Date.now() + ms);

async function paymentStep(sagaId: string) {
  return (await getSagaWithSteps(sagaId))?.steps.find((row) => row.name === "authorize-payment");
}

async function commands(type: string) {
  return db.query.outbox.findMany({ where: and(eq(outbox.queue, PAYMENTS_QUEUE), eq(outbox.type, type)) });
}

/** Checkout parado no pagamento, com o comando de cobrança já no broker. */
async function waitingForPayment() {
  const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1, priceCents: 12_000 });
  const checkout = await startCheckout(fixture);
  assert.equal((await runSagaInline(checkout.sagaId)).status, "waiting");
  await relayOutbox();
  return checkout;
}

describe("passo remoto — prazo", () => {
  it("o comando nasce com prazo; antes dele vencer, ninguém pergunta nada", async () => {
    const checkout = await waitingForPayment();

    const step = await paymentStep(checkout.sagaId);
    assert.ok(step?.deadlineAt, "passo remoto `waiting` tem prazo");
    const expected = Date.now() + PAYMENT_REPLY_TIMEOUT_MS;
    assert.ok(Math.abs(step.deadlineAt.getTime() - expected) < 10_000);

    assert.equal((await reconcile()).overdueRemoteSteps, 0);
    assert.equal((await commands(PAYMENT_STATUS)).length, 0);
  });

  it("comando perdido: vencido o prazo, a saga pergunta, não há cobrança, reenvia — e termina", async () => {
    const checkout = await waitingForPayment();
    await purgeQueues([PAYMENTS_QUEUE]); // o comando sumiu (DLQ, fila apagada)

    const report = await reconcile({ now: later(PAYMENT_REPLY_TIMEOUT_MS + 1_000) });
    assert.equal(report.overdueRemoteSteps, 1);
    assert.equal((await commands(PAYMENT_STATUS)).length, 1, "consulta de status enviada");
    assert.equal((await paymentStep(checkout.sagaId))?.statusChecks, 1);

    await work("payments"); // responde: nenhuma cobrança com essa chave
    await work("saga"); // a saga lê "not_found" e reenvia a cobrança
    assert.equal((await commands(PAYMENT_AUTHORIZE)).length, 2, "comando reenviado, com a mesma chave");
    assert.equal((await paymentStep(checkout.sagaId))?.status, "waiting");

    const saga = await settleSaga(checkout.sagaId, { inline: false });
    assert.equal(saga.status, "completed");
    const order = await db.query.orders.findFirst({ where: eq(orders.id, checkout.orderId) });
    assert.equal(order?.status, "paid");
    assert.equal((await db.query.payments.findMany({ where: eq(payments.orderId, checkout.orderId) })).length, 1);
  });

  it("resposta perdida: a consulta acha a cobrança e a saga conclui sem cobrar de novo", async () => {
    const checkout = await waitingForPayment();
    await work("payments"); // cobra e grava a resposta
    await relayOutbox();
    await purgeQueues([SAGA_QUEUE]); // a resposta sumiu no caminho

    assert.equal((await reconcile({ now: later(PAYMENT_REPLY_TIMEOUT_MS + 1_000) })).overdueRemoteSteps, 1);
    await work("payments"); // responde: paga
    const saga = await settleSaga(checkout.sagaId, { inline: false });

    assert.equal(saga.status, "completed");
    assert.equal((await commands(PAYMENT_AUTHORIZE)).length, 1, "nada foi reenviado: a cobrança já existia");
    const [payment] = await db.query.payments.findMany({ where: eq(payments.orderId, checkout.orderId) });
    assert.equal(payment.status, "paid");
    const step = await paymentStep(checkout.sagaId);
    assert.equal(step?.status, "completed");
    assert.equal((step?.output as { paymentId?: string })?.paymentId, payment.id, "a saga ficou com a cobrança certa");
    assert.equal(step?.deadlineAt, null, "passo concluído não tem prazo");
  });

  it("serviço que não responde: cada consulta dobra o prazo e, passadas 3, vira alerta", async () => {
    const checkout = await waitingForPayment();
    await purgeQueues([PAYMENTS_QUEUE]);

    let now = later(PAYMENT_REPLY_TIMEOUT_MS + 1_000);
    assert.equal((await reconcile({ now })).overdueRemoteSteps, 1);
    const first = await paymentStep(checkout.sagaId);
    assert.equal(first?.deadlineAt?.getTime(), now.getTime() + 2 * PAYMENT_REPLY_TIMEOUT_MS, "prazo dobrou");

    assert.equal((await reconcile({ now })).overdueRemoteSteps, 0, "não pergunta de novo antes do prazo novo");

    for (const checks of [2, 3]) {
      now = new Date((await paymentStep(checkout.sagaId))!.deadlineAt!.getTime() + 1_000);
      assert.equal((await reconcile({ now })).overdueRemoteSteps, 1);
      assert.equal((await paymentStep(checkout.sagaId))?.statusChecks, checks);
    }

    const metrics = await getSagaMetrics(db, { since: new Date(0) });
    assert.equal(metrics.overdueRemote, 1);
    assert.equal((await paymentStep(checkout.sagaId))?.status, "waiting", "não desiste: o resultado é desconhecido");
  });
});
