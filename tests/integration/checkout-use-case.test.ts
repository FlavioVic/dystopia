/**
 * Caso de uso do checkout (`src/application/checkout.ts`) — o que a Server
 * Action chama. Ele só grava: pedido `pending`, saga e a primeira mensagem na
 * mesma transação. Passo nenhum roda no request; quem anda é o consumidor.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { placeOrder, type PlaceOrderInput } from "@/application/checkout";
import { db } from "@/db";
import { addresses, orders, outbox, sagas, sagaSteps } from "@/db/schema";
import { shippingFor } from "@/lib/shipping";
import { closeDatabase, resetDatabase, seedCheckoutFixture, type CheckoutFixture } from "../helpers/db";

beforeEach(resetDatabase);
after(closeDatabase);

const NEW_ADDRESS = {
  label: "Casa",
  recipientName: "Cliente Teste",
  street: "Rua das Flores",
  number: "123",
  complement: null,
  neighborhood: "Centro",
  city: "São Paulo",
  state: "SP",
  zipCode: "01000-000",
};

function input(fixture: CheckoutFixture, overrides: Partial<PlaceOrderInput> = {}): PlaceOrderInput {
  return {
    customer: { id: fixture.userId, name: fixture.userName, email: fixture.userEmail },
    cartId: fixture.cartId,
    address: { values: NEW_ADDRESS },
    paymentMethod: "pix",
    couponCode: "",
    ...overrides,
  };
}

describe("caso de uso: fechar a compra", () => {
  it("grava pedido, saga e mensagem, avisa depois do commit e não executa passo nenhum", async () => {
    const fixture = await seedCheckoutFixture({ priceCents: 10_000, quantity: 2, coupon: { discountValue: 10 } });
    let committed = 0;

    const result = await placeOrder(input(fixture, { couponCode: fixture.couponCode! }), {
      afterCommit: () => void (committed += 1),
    });

    assert.ok(result.ok);
    const order = await db.query.orders.findFirst({ where: eq(orders.orderNumber, result.orderNumber) });
    assert.equal(order?.status, "pending");
    // Totais do servidor: 2 × R$ 100 com 10% de desconto, mais o frete.
    assert.equal(order?.subtotalCents, 20_000);
    assert.equal(order?.discountCents, 2_000);
    assert.equal(order?.totalCents, 18_000 + shippingFor(20_000));

    const saga = await db.query.sagas.findFirst({ where: eq(sagas.correlationId, result.orderNumber) });
    assert.equal(saga?.status, "running");
    assert.equal(await db.$count(sagaSteps), 0, "o request não roda passo da saga");
    const [message] = await db.select().from(outbox);
    assert.equal(message?.type, "saga.advance");
    assert.equal(committed, 1);
    assert.equal(await db.$count(addresses, eq(addresses.userId, fixture.userId)), 1, "endereço novo vai para a agenda");
  });

  it("carrinho vazio não grava nada nem avisa ninguém", async () => {
    const fixture = await seedCheckoutFixture();
    let committed = 0;

    const result = await placeOrder(input(fixture, { cartId: "00000000-0000-0000-0000-000000000000" }), {
      afterCommit: () => void (committed += 1),
    });

    assert.deepEqual(result, { ok: false, message: "Seu carrinho está vazio." });
    assert.equal(await db.$count(orders), 0);
    assert.equal(await db.$count(outbox), 0);
    assert.equal(committed, 0);
  });

  it("endereço salvo de outra pessoa não serve", async () => {
    const owner = await seedCheckoutFixture();
    const [address] = await db
      .insert(addresses)
      .values({ ...NEW_ADDRESS, userId: owner.userId })
      .returning({ id: addresses.id });
    const other = await seedCheckoutFixture();

    const result = await placeOrder(input(other, { address: { savedId: address.id } }));

    assert.deepEqual(result, { ok: false, message: "Endereço não encontrado na sua conta." });
    assert.equal(await db.$count(orders), 0);
  });
});
