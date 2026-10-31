/**
 * Direitos do titular: baixar os próprios dados e excluir a conta sem deixar
 * dado pessoal para trás (pedido, saga, e-mail, orçamento, avaliação).
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications, orders, products, sagas, serviceRequests, users } from "@/db/schema";
import { deleteAccount, exportAccountData } from "@/application/account-privacy";
import { PermanentError } from "@/shared/errors";
import { upsertReview } from "@/services/reviews";
import { createServiceRequest } from "@/services/service-requests";
import { createSession } from "@/services/sessions";
import { startCheckout } from "../helpers/checkout";
import { closeDatabase, resetDatabase, seedCheckoutFixture } from "../helpers/db";
import { settleSaga } from "../helpers/saga";

beforeEach(resetDatabase);
after(closeDatabase);

/** Conta com pedido pago (e o e-mail dele), avaliação e pedido de orçamento. */
async function accountWithHistory() {
  const fixture = await seedCheckoutFixture();
  const checkout = await startCheckout(fixture);
  assert.equal((await settleSaga(checkout.sagaId)).status, "completed");
  await upsertReview(db, { productId: fixture.product.id, userId: fixture.userId, rating: 5, title: null, comment: null });
  const request = await createServiceRequest(db, {
    kind: "manutencao",
    name: fixture.userName,
    email: fixture.userEmail,
    phone: "85999990000",
    details: "PC desligando sozinho durante jogos.",
    userId: null,
  });
  return { fixture, checkout, request };
}

describe("dados da conta", () => {
  it("o download traz conta, pedidos, avaliações, orçamentos e logins, sem hash de senha nem de sessão", async () => {
    const { fixture, checkout, request } = await accountWithHistory();
    const { token } = await createSession(db, { userId: fixture.userId, mfaPending: false });

    const data = await exportAccountData(fixture.userId);

    assert.equal(data?.conta.email, fixture.userEmail);
    assert.deepEqual(data?.pedidos.map((o) => o.orderNumber), [checkout.orderNumber]);
    assert.equal(data?.avaliacoes.length, 1);
    assert.deepEqual(data?.orcamentos.map((r) => r.protocol), [request.protocol], "acha o orçamento pelo e-mail");
    assert.ok(!JSON.stringify(data).includes("hash-de-teste"));
    assert.equal(data?.sessoes.length, 1);
    assert.deepEqual(Object.keys(data!.sessoes[0]).sort(), ["createdAt", "expiresAt"]);
    assert.ok(!JSON.stringify(data).includes(token));
  });

  it("excluir apaga a conta e o que carrega dado dela, recalcula a nota e não toca em outra conta", async () => {
    const { fixture, checkout, request } = await accountWithHistory();
    const other = await accountWithHistory();

    assert.deepEqual(await deleteAccount(fixture.userId), { deleted: true });

    assert.equal(await db.$count(users, eq(users.id, fixture.userId)), 0);
    assert.equal(await db.$count(orders, eq(orders.userId, fixture.userId)), 0);
    assert.equal(await db.$count(sagas, eq(sagas.correlationId, checkout.orderNumber)), 0);
    assert.equal(await db.$count(notifications, eq(notifications.correlationId, checkout.orderNumber)), 0);
    assert.equal(await db.$count(notifications, eq(notifications.recipient, fixture.userEmail)), 0);
    assert.equal(await db.$count(serviceRequests, eq(serviceRequests.protocol, request.protocol)), 0);

    const product = await db.query.products.findFirst({ where: eq(products.id, fixture.product.id) });
    assert.equal(product?.ratingCount, 0, "a média não guarda a nota de quem saiu");

    assert.equal(await db.$count(orders, eq(orders.userId, other.fixture.userId)), 1);
    assert.equal(await db.$count(serviceRequests, eq(serviceRequests.protocol, other.request.protocol)), 1);
  });

  it("admin não se exclui por aqui", async () => {
    const { fixture } = await accountWithHistory();
    await db.update(users).set({ role: "admin" }).where(eq(users.id, fixture.userId));

    await assert.rejects(
      deleteAccount(fixture.userId),
      (error) => error instanceof PermanentError && error.code === "admin_account",
    );
    assert.equal(await db.$count(users, eq(users.id, fixture.userId)), 1);
  });
});
