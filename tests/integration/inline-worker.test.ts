/**
 * Worker embutido (deploy só-Vercel): sem processo de fila de pé, uma rodada
 * de `runInlineWorker` depois do request tem que levar o pedido até o fim —
 * outbox publicada, pagamento remoto, resposta, e-mail e, se o gateway
 * oscilar, o retry que passa pela fila de espera do RabbitMQ (que a rodada
 * espera, em vez de largar para um worker que não existe).
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { runInlineWorker } from "@/composition/worker";
import { db } from "@/db";
import { notifications, orders } from "@/db/schema";
import { enqueue } from "@/queue";
import { getBroker, names, purgeQueues } from "@/queue/broker";
import { relayOutbox } from "@/queue/relay";
import { drainQueues } from "@/queue/worker";
import { closeDatabase, resetDatabase, seedCheckoutFixture } from "../helpers/db";
import { startCheckout } from "../helpers/checkout";
import { IDLE, pendingWork } from "../helpers/saga";

// Entrega de e-mail simulada mesmo que o .env tenha a chave do Resend.
delete process.env.RESEND_API_KEY;

const Q = "teste";

beforeEach(async () => {
  await resetDatabase();
  await purgeQueues([Q]);
});
after(closeDatabase);

/** O que o placeOrder faz no request: grava pedido, saga e mensagem, e só. */
async function checkoutRequest(simulate?: "flaky_once" | "decline") {
  const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1, priceCents: 5_000 });
  return startCheckout(fixture, simulate ? { simulate } : {});
}

const orderStatus = async (orderId: string) =>
  (await db.query.orders.findFirst({ where: eq(orders.id, orderId) }))?.status;

describe("worker embutido", () => {
  it("uma rodada depois do request fecha o pedido e entrega o e-mail", async () => {
    const checkout = await checkoutRequest();
    // O request não executa passo nenhum: sem worker, ficaria assim para sempre.
    assert.equal(await orderStatus(checkout.orderId), "pending");

    await runInlineWorker({ budgetMs: 10_000, waitForScheduled: true });

    assert.equal(await orderStatus(checkout.orderId), "paid");
    const [notification] = await db.select().from(notifications);
    assert.equal(notification?.status, "sent");
    assert.deepEqual(await pendingWork(), IDLE, "nada sobra para um worker que não existe");
  });

  it("espera o retry do pagamento voltar da fila de espera em vez de largar a fila", async () => {
    const checkout = await checkoutRequest("flaky_once");

    const report = await runInlineWorker({ budgetMs: 15_000, waitForScheduled: true });

    assert.ok(report.retried >= 1, "a primeira tentativa do gateway falhou");
    assert.equal(await orderStatus(checkout.orderId), "paid");
    assert.deepEqual(await pendingWork(), IDLE);
  });

  it("sem waitForScheduled, larga o retry para a próxima rodada (e a próxima termina)", async () => {
    const checkout = await checkoutRequest("flaky_once");

    await runInlineWorker({ budgetMs: 15_000 });
    assert.equal(await orderStatus(checkout.orderId), "pending");
    assert.equal((await pendingWork()).retrying, 1, "o retry ficou na fila de espera do broker");

    await runInlineWorker({ budgetMs: 15_000, waitForScheduled: true });
    assert.equal(await orderStatus(checkout.orderId), "paid");
  });

  it("não desiste enquanto outro consumidor segura uma mensagem que pode voltar", async () => {
    // O caso da Vercel: o redirect do placeOrder renderiza a página do pedido
    // no mesmo request, e o dreno dela pega o pagamento antes do dreno do
    // checkout. Mensagem sem ack não aparece em contagem nenhuma do broker;
    // se este saísse por ver tudo "vazio", ela ficava órfã.
    await enqueue(db, { type: "teste.instavel", queue: Q });
    await relayOutbox(db);
    const broker = await getBroker();
    const other = await broker.connection.createChannel();
    assert.ok(await other.get(names(Q, broker.config).work, { noAck: false }), "o outro executor pegou");

    let handled = 0;
    const drain = drainQueues({
      outboxes: [db],
      queues: [Q],
      budgetMs: 5_000,
      waitForScheduled: true,
      handlers: { "teste.instavel": async () => void (handled += 1) },
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await other.close(); // o outro executor morreu sem ack: a mensagem volta

    const report = await drain;
    assert.equal(handled, 1, "o dreno que espera pegou a mensagem");
    assert.equal(report.acked, 1);
  });

  it("não espera retry que só volta depois do orçamento", async () => {
    // Fila de espera de 400 ms, orçamento de 200 ms.
    await enqueue(db, { type: "teste.noop", queue: Q, delayMs: 400 });
    await relayOutbox(db);

    const startedAt = Date.now();
    await drainQueues({ outboxes: [db], queues: [Q], budgetMs: 200, waitForScheduled: true, handlers: {} });
    assert.ok(Date.now() - startedAt < 350, "saiu em vez de dormir até o retry");
  });
});
