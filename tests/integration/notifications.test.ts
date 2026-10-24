/**
 * Entrega de e-mail: outbox (gravada no passo, entregue por job), modo
 * sandbox, idempotência, recusa definitiva e retry até a última tentativa.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, notifications } from "@/db/schema";
import { NOTIFICATION_DELIVER_JOB, sendOrderConfirmation } from "@/services/notifications";
import { deliverNotification, type DeliveryDeps } from "@/services/notifications/delivery";
import type { FetchLike } from "@/services/notifications/resend";
import { closeDatabase, resetDatabase } from "../helpers/db";

beforeEach(resetDatabase);
after(closeDatabase);

const order = {
  orderNumber: "DYS-2026-000001",
  recipient: "comprador@exemplo.dev",
  customerName: "Ana",
  totalCents: 12_990,
  items: [{ name: "Action Figure", quantity: 1 }],
};

function sandbox(response: { status: number; body: unknown }): DeliveryDeps & { calls: RequestInit[] } {
  const calls: RequestInit[] = [];
  const fetch: FetchLike = async (_url, init) => {
    calls.push(init);
    return new Response(JSON.stringify(response.body), { status: response.status });
  };
  return { email: { apiKey: "re_test", from: "Dystopia <onboarding@resend.dev>", redirectTo: "dono@exemplo.dev" }, fetch, calls };
}

async function notification(id: string) {
  return db.query.notifications.findFirst({ where: eq(notifications.id, id) });
}

describe("notificação — outbox", () => {
  it("o passo grava a notificação pendente e enfileira a entrega; repetir não duplica nada", async () => {
    const first = await db.transaction((tx) => sendOrderConfirmation(tx, order));
    const again = await db.transaction((tx) => sendOrderConfirmation(tx, order));

    assert.equal(again.duplicate, true);
    assert.equal(again.notificationId, first.notificationId);
    assert.equal((await notification(first.notificationId))?.status, "pending");

    const deliveries = await db.query.jobs.findMany({ where: eq(jobs.type, NOTIFICATION_DELIVER_JOB) });
    assert.equal(deliveries.length, 1, "uma entrega só");
    assert.deepEqual(deliveries[0].payload, { notificationId: first.notificationId });
  });
});

describe("notificação — entrega", () => {
  it("sandbox: vai pro dono do projeto, com o destinatário original no assunto", async () => {
    const { notificationId } = await sendOrderConfirmation(db, order);
    const deps = sandbox({ status: 200, body: { id: "msg_42" } });

    assert.equal(await deliverNotification(db, notificationId, { deps }), "sent");

    const sentBody = JSON.parse(String(deps.calls[0].body));
    assert.deepEqual(sentBody.to, ["dono@exemplo.dev"]);
    assert.equal(sentBody.subject, "[demo → comprador@exemplo.dev] Aquisição DYS-2026-000001 registrada");
    assert.equal((deps.calls[0].headers as Record<string, string>)["Idempotency-Key"], "order-confirmation:DYS-2026-000001");

    const row = await notification(notificationId);
    assert.equal(row?.status, "sent");
    assert.equal(row?.provider, "resend");
    assert.equal(row?.providerMessageId, "msg_42");
    assert.equal(row?.deliveredTo, "dono@exemplo.dev");
    assert.equal(row?.recipient, "comprador@exemplo.dev", "o destinatário original fica registrado");
  });

  it("já enviada não sai de novo (job reprocessado depois de um crash)", async () => {
    const { notificationId } = await sendOrderConfirmation(db, order);
    await deliverNotification(db, notificationId, { deps: sandbox({ status: 200, body: { id: "msg_1" } }) });

    const second = sandbox({ status: 200, body: { id: "msg_2" } });
    assert.equal(await deliverNotification(db, notificationId, { deps: second }), "already-sent");
    assert.equal(second.calls.length, 0);
  });

  it("recusa definitiva marca `failed` sem jogar pra fila tentar de novo", async () => {
    const { notificationId } = await sendOrderConfirmation(db, order);
    const deps = sandbox({ status: 422, body: { name: "validation_error", message: "Endereço inválido" } });

    assert.equal(await deliverNotification(db, notificationId, { deps }), "failed");
    const row = await notification(notificationId);
    assert.equal(row?.status, "failed");
    assert.equal(row?.lastError, "Endereço inválido");
  });

  it("indisponível: segue pendente pro retry; na última tentativa vira `failed`", async () => {
    const { notificationId } = await sendOrderConfirmation(db, order);
    const deps = sandbox({ status: 503, body: {} });

    await assert.rejects(deliverNotification(db, notificationId, { deps }), /indisponível/);
    assert.equal((await notification(notificationId))?.status, "pending");

    await assert.rejects(deliverNotification(db, notificationId, { deps, finalAttempt: true }), /indisponível/);
    const row = await notification(notificationId);
    assert.equal(row?.status, "failed");
    assert.match(row?.lastError ?? "", /indisponível/);
  });

  it("sem chave do Resend, a entrega é simulada", async () => {
    const { notificationId } = await sendOrderConfirmation(db, order);
    const fetch: FetchLike = () => Promise.reject(new Error("não devia chamar a rede"));
    assert.equal(await deliverNotification(db, notificationId, { deps: { email: null, fetch } }), "sent");
    const row = await notification(notificationId);
    assert.deepEqual([row?.status, row?.provider, row?.deliveredTo], ["sent", "simulado", "comprador@exemplo.dev"]);
  });
});
