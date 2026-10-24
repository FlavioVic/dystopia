/**
 * Worker embutido (deploy só-Vercel): sem processo de fila de pé, uma rodada
 * de `runInlineWorker` depois do request tem que levar o pedido até o fim —
 * pagamento remoto, resposta, e-mail e, se o gateway oscilar, o retry em
 * backoff (que a rodada espera, em vez de largar pra um worker que não existe).
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { runInlineWorker } from "@/composition/worker";
import { db } from "@/db";
import { jobs, notifications, orders } from "@/db/schema";
import * as queue from "@/queue";
import { drainQueue } from "@/queue/worker";
import { tryRunSagaInline } from "@/saga/runner";
import { closeDatabase, resetDatabase, seedCheckoutFixture } from "../helpers/db";
import { startCheckout } from "../helpers/checkout";

// Entrega de e-mail simulada mesmo que o .env tenha a chave do Resend.
delete process.env.RESEND_API_KEY;

beforeEach(resetDatabase);
after(closeDatabase);

async function activeJobs() {
  return db.query.jobs.findMany({ where: inArray(jobs.status, ["queued", "running", "failed"]) });
}

/** O que o placeOrder faz no request: avança até o passo remoto e para. */
async function checkoutRequest(simulate?: "flaky_once" | "decline") {
  const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1, priceCents: 5_000 });
  const checkout = await startCheckout(fixture, simulate ? { simulate } : {});
  await tryRunSagaInline(checkout.sagaId);
  return checkout;
}

describe("worker embutido", () => {
  it("uma rodada depois do request fecha o pedido e entrega o e-mail", async () => {
    const checkout = await checkoutRequest();
    // O request parou no pagamento (remoto): sem worker, ficaria assim pra sempre.
    assert.equal((await db.query.orders.findFirst({ where: eq(orders.id, checkout.orderId) }))?.status, "pending");

    await runInlineWorker({ budgetMs: 10_000, waitForScheduled: true });

    const order = await db.query.orders.findFirst({ where: eq(orders.id, checkout.orderId) });
    assert.equal(order?.status, "paid");
    const [notification] = await db.select().from(notifications);
    assert.equal(notification?.status, "sent");
    assert.deepEqual(await activeJobs(), [], "nada sobra pra um worker que não existe");
  });

  it("espera o retry em backoff do pagamento em vez de largar a fila", async () => {
    const checkout = await checkoutRequest("flaky_once");

    const report = await runInlineWorker({ budgetMs: 15_000, waitForScheduled: true });

    assert.ok(report.failed >= 1, "a primeira tentativa do gateway falhou");
    const order = await db.query.orders.findFirst({ where: eq(orders.id, checkout.orderId) });
    assert.equal(order?.status, "paid");
    assert.deepEqual(await activeJobs(), []);
  });

  it("sem waitForScheduled, larga o retry pra próxima rodada (e a próxima termina)", async () => {
    const checkout = await checkoutRequest("flaky_once");

    await runInlineWorker({ budgetMs: 15_000 });
    assert.equal((await db.query.orders.findFirst({ where: eq(orders.id, checkout.orderId) }))?.status, "pending");
    const pending = await queue.nextScheduledAt(["default", "payments"]);
    assert.ok(pending && pending.getTime() > Date.now() - 1_000, "o retry ficou agendado");

    await runInlineWorker({ budgetMs: 15_000, waitForScheduled: true });
    assert.equal((await db.query.orders.findFirst({ where: eq(orders.id, checkout.orderId) }))?.status, "paid");
  });

  it("não desiste enquanto outro executor segura um job que pode virar retry", async () => {
    // O caso da Vercel: o redirect do placeOrder renderiza a página do pedido
    // no mesmo request, e o dreno dela (que não espera) pega o pagamento antes
    // do dreno do checkout. Se este saísse por ver a fila "vazia", o retry
    // ficava órfão.
    await queue.enqueue(db, { type: "teste.instavel", payload: {} });
    const [held] = await queue.claim({ workerId: "outro-executor" });
    assert.ok(held);

    let handled = 0;
    const drain = drainQueue({
      budgetMs: 5_000,
      waitForScheduled: true,
      handlers: { "teste.instavel": async () => ((handled += 1), { settled: false }) },
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await queue.fail(held.id, "gateway instável", { runAt: new Date(Date.now() + 300) });

    const report = await drain;
    assert.equal(handled, 1, "o dreno que espera pegou o retry");
    assert.equal(report.completed, 1);
    assert.deepEqual(await activeJobs(), []);
  });

  it("não espera retry que cai fora do orçamento", async () => {
    await queue.enqueue(db, { type: "teste.noop", runAt: new Date(Date.now() + 60_000), payload: {} });

    const startedAt = Date.now();
    await drainQueue({ budgetMs: 2_000, waitForScheduled: true, handlers: {} });
    assert.ok(Date.now() - startedAt < 1_500, "saiu na hora em vez de dormir até o job");
  });
});
