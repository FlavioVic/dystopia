/**
 * Testes de integração da SAGA de checkout, contra Postgres de verdade.
 *
 * Cada caso cobre um caminho da orquestração: feliz, compensação por regra de
 * negócio, retry de falha transitória (incluindo o worker) e idempotência.
 *
 * O pagamento é um passo remoto (processo próprio, fila `payments`): o
 * request avança até ele e a saga estaciona em `waiting`; `settleSaga` roda os
 * consumidores do RabbitMQ até o fim, como em produção.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { and } from "drizzle-orm";
import { cartItems, coupons, notifications, orders, outbox, payments, products, sagas } from "@/db/schema";
import { queueDepths } from "@/queue/broker";
import { advanceSaga, getSagaWithSteps } from "@/saga/orchestrator";
import { runSagaInline } from "@/saga/runner";
import { PAYMENT_AUTHORIZE, PAYMENTS_QUEUE } from "@/services/payments/contract";
import { closeDatabase, resetDatabase, seedCheckoutFixture } from "../helpers/db";
import { startCheckout } from "../helpers/checkout";
import { IDLE, lastErrorCode, pendingWork, settleSaga, waitForRetries, work } from "../helpers/saga";

beforeEach(resetDatabase);
after(closeDatabase);

async function stockOf(productId: string): Promise<number> {
  const product = await db.query.products.findFirst({
    where: eq(products.id, productId),
    columns: { stockQuantity: true },
  });
  return product?.stockQuantity ?? -1;
}

/** Mensagens gravadas na outbox (publicadas ou não), na ordem em que nasceram. */
async function outboxTypes(): Promise<string[]> {
  const rows = await db.query.outbox.findMany({ orderBy: (row, { asc }) => [asc(row.createdAt)] });
  return rows.map((row) => row.type);
}

async function stepStatuses(sagaId: string): Promise<Record<string, string>> {
  const saga = await getSagaWithSteps(sagaId);
  return Object.fromEntries((saga?.steps ?? []).map((step) => [step.name, step.status]));
}

describe("saga de checkout — caminho feliz", () => {
  it("confirma o pedido e aplica todos os efeitos uma única vez", async () => {
    const fixture = await seedCheckoutFixture({
      stock: 10,
      quantity: 2,
      priceCents: 9_990,
      coupon: { discountType: "percentage", discountValue: 10 },
    });
    const checkout = await startCheckout(fixture, { useCoupon: true });

    // O pedido nasce pendente e a mensagem nasce junto, na mesma transação (outbox).
    const created = await db.query.orders.findFirst({ where: eq(orders.id, checkout.orderId) });
    assert.equal(created?.status, "pending");
    assert.deepEqual(await outboxTypes(), ["saga.advance"], "a mensagem de avanço existe junto do pedido");
    assert.equal((await pendingWork()).outbox, 1, "e ainda não foi publicada: quem publica é o relay");

    // O request avança até o pagamento, que é remoto: a saga estaciona.
    const inline = await runSagaInline(checkout.sagaId);
    assert.deepEqual(inline, { status: "waiting", step: "authorize-payment" });
    assert.equal((await stepStatuses(checkout.sagaId))["authorize-payment"], "waiting");
    const command = await db.query.outbox.findFirst({
      where: and(eq(outbox.queue, PAYMENTS_QUEUE), eq(outbox.type, PAYMENT_AUTHORIZE)),
    });
    assert.ok(command, "o comando de cobrança foi gravado para a fila de pagamentos, junto do passo");

    const saga0 = await settleSaga(checkout.sagaId, { inline: false });
    assert.equal(saga0.status, "completed");

    const order = await db.query.orders.findFirst({ where: eq(orders.id, checkout.orderId) });
    assert.equal(order?.status, "paid");
    assert.equal(order?.discountCents, 1_998, "10% de R$ 199,80");
    assert.equal(order?.shippingCents, 0, "frete grátis acima de R$ 149,90");
    assert.equal(order?.totalCents, 17_982);

    assert.equal(await stockOf(fixture.product.id), 8, "estoque baixado uma vez");

    const coupon = await db.query.coupons.findFirst({ where: eq(coupons.id, fixture.couponId!) });
    assert.equal(coupon?.usageCount, 1);

    const paymentRows = await db.query.payments.findMany({ where: eq(payments.orderId, checkout.orderId) });
    assert.equal(paymentRows.length, 1);
    assert.equal(paymentRows[0].status, "paid");
    assert.equal(paymentRows[0].amountCents, 17_982);
    assert.ok(paymentRows[0].transactionId?.startsWith("SIM-"));

    const remainingCart = await db.query.cartItems.findMany({ where: eq(cartItems.cartId, fixture.cartId) });
    assert.equal(remainingCart.length, 0, "carrinho esvaziado");

    const sent = await db.query.notifications.findMany({
      where: eq(notifications.correlationId, checkout.orderNumber),
    });
    assert.equal(sent.length, 1);

    const saga = await getSagaWithSteps(checkout.sagaId);
    assert.equal(saga?.status, "completed");
    assert.equal(saga?.currentStep, 6);
    assert.ok(saga?.finishedAt);
    assert.equal(saga?.lockedBy, null, "lease liberado no fim");
    assert.deepEqual(await stepStatuses(checkout.sagaId), {
      "reserve-stock": "completed",
      "authorize-payment": "completed",
      "consume-coupon": "completed",
      "confirm-order": "completed",
      "clear-cart": "completed",
      "notify-customer": "completed",
    });

    // A confirmação sai por outbox: gravada no passo, entregue por OUTRA
    // mensagem (fila `notifications`) — o e-mail nunca sai de dentro do passo.
    assert.deepEqual(await outboxTypes(), [
      "saga.advance",
      "payments.authorize",
      "saga.reply",
      "notifications.deliver",
    ]);
    const delivered = await db.query.notifications.findFirst({ where: eq(notifications.id, sent[0].id) });
    assert.equal(delivered?.status, "sent");
    assert.equal(delivered?.provider, "simulado", "sem RESEND_API_KEY a entrega é simulada");

    // Nada sobra para consumidor nenhum: avanço, comando, resposta e entrega com ack.
    assert.deepEqual(await pendingWork(), IDLE);
    assert.equal((await work("all")).received, 0);
  });

  it("pula o passo do cupom quando o pedido não usa cupom", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1, priceCents: 5_000 });
    const checkout = await startCheckout(fixture);

    assert.equal((await settleSaga(checkout.sagaId)).status, "completed");

    const saga = await getSagaWithSteps(checkout.sagaId);
    const couponStep = saga?.steps.find((step) => step.name === "consume-coupon");
    assert.equal(couponStep?.status, "completed");
    assert.deepEqual(couponStep?.output, { skipped: true });

    const order = await db.query.orders.findFirst({ where: eq(orders.id, checkout.orderId) });
    assert.equal(order?.shippingCents, 1_990, "abaixo do mínimo, frete cobrado");
    assert.equal(order?.totalCents, 6_990);
  });

  it("baixa estoque da variante quando o item tem variante", async () => {
    const fixture = await seedCheckoutFixture({ stock: 9, variantStock: 4, quantity: 3, withVariant: true });
    const checkout = await startCheckout(fixture);

    assert.equal((await settleSaga(checkout.sagaId)).status, "completed");

    const variant = await db.query.productVariants.findFirst({
      where: (table, { eq: equals }) => equals(table.id, fixture.variantId!),
    });
    assert.equal(variant?.stockQuantity, 1, "variante baixou");
    assert.equal(await stockOf(fixture.product.id), 9, "produto-pai intocado");
  });
});

describe("saga de checkout — compensação", () => {
  it("cancela o pedido e devolve tudo quando falta estoque", async () => {
    const fixture = await seedCheckoutFixture({ stock: 1, quantity: 3, priceCents: 10_000 });
    const checkout = await startCheckout(fixture);

    const outcome = await runSagaInline(checkout.sagaId);
    assert.equal(outcome.status, "compensated");
    if (outcome.status === "compensated") {
      assert.equal(outcome.code, "out_of_stock");
      assert.match(outcome.reason, /estoque/i);
    }

    const order = await db.query.orders.findFirst({ where: eq(orders.id, checkout.orderId) });
    assert.equal(order?.status, "cancelled");

    assert.equal(await stockOf(fixture.product.id), 1, "estoque intocado");
    assert.equal(
      (await db.query.payments.findMany({ where: eq(payments.orderId, checkout.orderId) })).length,
      0,
      "não cobra quem não tem estoque",
    );
    assert.equal(
      (await db.query.cartItems.findMany({ where: eq(cartItems.cartId, fixture.cartId) })).length,
      1,
      "carrinho preservado",
    );

    const saga = await db.query.sagas.findFirst({ where: eq(sagas.id, checkout.sagaId) });
    assert.equal(saga?.status, "compensated");
    assert.match(saga?.lastError ?? "", /out_of_stock/);
    assert.equal((await stepStatuses(checkout.sagaId))["reserve-stock"], "failed");
  });

  it("devolve o estoque quando o pagamento é recusado", async () => {
    const fixture = await seedCheckoutFixture({ stock: 6, quantity: 2, priceCents: 7_500 });
    const checkout = await startCheckout(fixture, { simulate: "decline" });

    const saga = await settleSaga(checkout.sagaId);
    assert.equal(saga.status, "compensated");
    assert.equal(lastErrorCode(saga), "payment_declined");

    assert.equal(await stockOf(fixture.product.id), 6, "estoque devolvido pela compensação");
    const order = await db.query.orders.findFirst({ where: eq(orders.id, checkout.orderId) });
    assert.equal(order?.status, "cancelled");

    const statuses = await stepStatuses(checkout.sagaId);
    assert.equal(statuses["reserve-stock"], "compensated");
    assert.equal(statuses["authorize-payment"], "failed");
    assert.equal(statuses["consume-coupon"], undefined, "passos seguintes nem começaram");
  });

  it("estorna o pagamento quando o cupom esgota no meio do caminho", async () => {
    const fixture = await seedCheckoutFixture({
      stock: 4,
      quantity: 1,
      priceCents: 20_000,
      coupon: { discountType: "fixed", discountValue: 5_000, maxUsage: 1, usageCount: 1 },
    });
    const checkout = await startCheckout(fixture, { useCoupon: true });

    const saga = await settleSaga(checkout.sagaId);
    assert.equal(saga.status, "compensated");
    assert.equal(lastErrorCode(saga), "coupon_exhausted");

    const paymentRows = await db.query.payments.findMany({ where: eq(payments.orderId, checkout.orderId) });
    assert.equal(paymentRows.length, 1);
    assert.equal(paymentRows[0].status, "refunded", "cobrança estornada");

    assert.equal(await stockOf(fixture.product.id), 4, "estoque devolvido");
    const coupon = await db.query.coupons.findFirst({ where: eq(coupons.id, fixture.couponId!) });
    assert.equal(coupon?.usageCount, 1, "uso do cupom não foi incrementado");

    const order = await db.query.orders.findFirst({ where: eq(orders.id, checkout.orderId) });
    assert.equal(order?.status, "cancelled");

    const statuses = await stepStatuses(checkout.sagaId);
    assert.equal(statuses["reserve-stock"], "compensated");
    assert.equal(statuses["authorize-payment"], "compensated");
    assert.equal(statuses["consume-coupon"], "failed");
  });
});

describe("saga de checkout — retry e worker", () => {
  it("falha transitória: o processo de pagamentos tenta de novo com backoff e a saga conclui", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1, priceCents: 30_000 });
    const checkout = await startCheckout(fixture, { simulate: "flaky_once" });

    assert.equal((await runSagaInline(checkout.sagaId)).status, "waiting");

    // 1ª tentativa no processo de pagamentos: gateway fora → o COMANDO vai para
    // fila de espera dele no broker (o retry é de quem executa).
    const first = await work("payments");
    assert.deepEqual(first, { received: 1, acked: 0, retried: 1, dead: 0 });
    const [payments0] = await queueDepths([PAYMENTS_QUEUE]);
    assert.equal(payments0.retrying, 1, "comando na fila de espera, aguardando o TTL");

    const order = await db.query.orders.findFirst({ where: eq(orders.id, checkout.orderId) });
    assert.equal(order?.status, "pending", "pedido segue pendente entre as tentativas");
    const waiting = await db.query.sagas.findFirst({ where: eq(sagas.id, checkout.sagaId) });
    assert.equal(waiting?.lockedBy, null, "a saga não segura lease enquanto espera");
    assert.equal((await stepStatuses(checkout.sagaId))["authorize-payment"], "waiting");

    // O TTL vence, o comando volta para a fila: 2ª tentativa aprova e a resposta acorda a saga.
    await waitForRetries();
    const saga = await settleSaga(checkout.sagaId, { inline: false });
    assert.equal(saga.status, "completed");

    const finished = await db.query.orders.findFirst({ where: eq(orders.id, checkout.orderId) });
    assert.equal(finished?.status, "paid");
    const paymentRows = await db.query.payments.findMany({ where: eq(payments.orderId, checkout.orderId) });
    assert.equal(paymentRows.length, 1, "a tentativa que falhou não deixou cobrança");

    const step = (await getSagaWithSteps(checkout.sagaId))?.steps.find((row) => row.name === "authorize-payment");
    assert.equal(step?.attempts, 2, "o passo registra as tentativas que o outro processo gastou");
  });

  it("esgotadas as tentativas, pagamentos responde com falha e a saga compensa", async () => {
    const fixture = await seedCheckoutFixture({ stock: 3, quantity: 1, priceCents: 15_000 });
    const checkout = await startCheckout(fixture, { simulate: "unavailable" });

    const saga = await settleSaga(checkout.sagaId);
    assert.equal(saga.status, "compensated");
    assert.equal(lastErrorCode(saga), "gateway_unavailable");

    assert.equal(await stockOf(fixture.product.id), 3, "estoque devolvido");
    const order = await db.query.orders.findFirst({ where: eq(orders.id, checkout.orderId) });
    assert.equal(order?.status, "cancelled");

    const step = (await getSagaWithSteps(checkout.sagaId))?.steps.find(
      (candidate) => candidate.name === "authorize-payment",
    );
    assert.equal(step?.status, "failed");
    assert.equal(step?.attempts, 3, "maxAttemptsPerStep = 3 vale para o comando remoto");

    assert.equal((await pendingWork()).dead, 0, "ninguém foi para DLQ: a falha virou resposta");
  });
});

describe("saga de checkout — idempotência e concorrência", () => {
  it("reexecutar uma saga concluída não aplica efeito de novo", async () => {
    const fixture = await seedCheckoutFixture({
      stock: 10,
      quantity: 2,
      priceCents: 9_990,
      coupon: { discountType: "percentage", discountValue: 10 },
    });
    const checkout = await startCheckout(fixture, { useCoupon: true });
    assert.equal((await settleSaga(checkout.sagaId)).status, "completed");

    const again = await runSagaInline(checkout.sagaId);
    assert.equal(again.status, "settled");

    assert.equal(await stockOf(fixture.product.id), 8);
    const coupon = await db.query.coupons.findFirst({ where: eq(coupons.id, fixture.couponId!) });
    assert.equal(coupon?.usageCount, 1);
  });

  it("retomada de uma saga marcada como em andamento não duplica passos já aplicados", async () => {
    const fixture = await seedCheckoutFixture({ stock: 10, quantity: 2, priceCents: 9_990 });
    const checkout = await startCheckout(fixture);
    assert.equal((await settleSaga(checkout.sagaId)).status, "completed");

    // Simula um processo que morreu ANTES de marcar a saga como concluída:
    // o estado volta para "running" no passo 0, mas os passos já têm log.
    await db
      .update(sagas)
      .set({ status: "running", currentStep: 0, finishedAt: null })
      .where(eq(sagas.id, checkout.sagaId));

    const resumed = await advanceSaga(checkout.sagaId, { workerId: "retomada" });
    assert.equal(resumed.status, "completed");

    assert.equal(await stockOf(fixture.product.id), 8, "estoque NÃO baixou duas vezes");
    assert.equal(
      (await db.query.payments.findMany({ where: eq(payments.orderId, checkout.orderId) })).length,
      1,
      "pagamento não duplicou",
    );
    assert.equal(
      (await db.query.notifications.findMany({
        where: eq(notifications.correlationId, checkout.orderNumber),
      })).length,
      1,
      "notificação não duplicou",
    );
  });

  it("saga com lease vivo em outro executor responde 'busy' e não mexe em nada", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1 });
    const checkout = await startCheckout(fixture);

    await db
      .update(sagas)
      .set({ lockedBy: "outro-worker", leaseUntil: new Date(Date.now() + 60_000) })
      .where(eq(sagas.id, checkout.sagaId));

    const outcome = await advanceSaga(checkout.sagaId, { workerId: "eu" });
    assert.equal(outcome.status, "busy");
    assert.ok(
      outcome.status === "busy" && outcome.retryAt.getTime() <= Date.now(),
      "outro executor trabalhando: reolha logo, não no fim do lease",
    );

    // Já no backoff de um retry, "ocupada" vale até a hora exata do retry.
    const runAt = new Date(Date.now() + 45_000);
    await db.update(sagas).set({ lockedBy: "backoff", leaseUntil: runAt }).where(eq(sagas.id, checkout.sagaId));
    const held = await advanceSaga(checkout.sagaId, { workerId: "eu" });
    assert.deepEqual(held, { status: "busy", retryAt: runAt });

    const order = await db.query.orders.findFirst({ where: eq(orders.id, checkout.orderId) });
    assert.equal(order?.status, "pending");
    assert.equal(await stockOf(fixture.product.id), 5);
  });

  it("mensagem de saga inexistente é encerrada sem erro", async () => {
    const outcome = await advanceSaga("00000000-0000-0000-0000-000000000000");
    assert.equal(outcome.status, "not-found");
  });
});
