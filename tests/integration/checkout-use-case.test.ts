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
import { addresses, coupons, orders, outbox, products, sagas, sagaSteps } from "@/db/schema";
import { formatPriceCents } from "@/lib/format";
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

  it("cobra o preço atual do catálogo, não o que o carrinho guardou ao adicionar", async () => {
    const fixture = await seedCheckoutFixture({ priceCents: 10_000, quantity: 2 });
    await db.update(products).set({ priceCents: 12_000 }).where(eq(products.id, fixture.product.id));

    const result = await placeOrder(input(fixture));

    assert.ok(result.ok);
    const order = await db.query.orders.findFirst({
      where: eq(orders.orderNumber, result.orderNumber),
      with: { items: true },
    });
    assert.equal(order?.subtotalCents, 24_000);
    assert.equal(order?.items[0]?.unitPriceCents, 12_000);
  });

  it("produto que saiu de venda depois de entrar no carrinho: recusa dizendo qual", async () => {
    const fixture = await seedCheckoutFixture();
    await db.update(products).set({ isActive: false }).where(eq(products.id, fixture.product.id));
    const product = await db.query.products.findFirst({ where: eq(products.id, fixture.product.id) });

    const result = await placeOrder(input(fixture));

    assert.deepEqual(result, {
      ok: false,
      message: `“${product?.name}” saiu de venda. Tire do carrinho para concluir a compra.`,
    });
    assert.equal(await db.$count(orders), 0);
  });

  it("total diferente do que a tela mostrou: recusa com o valor novo e pede para recarregar", async () => {
    const fixture = await seedCheckoutFixture({ priceCents: 10_000, quantity: 1 });
    const shown = 10_000 + shippingFor(10_000);
    await db.update(products).set({ priceCents: 11_000 }).where(eq(products.id, fixture.product.id));

    const result = await placeOrder(input(fixture, { expectedTotalCents: shown }));

    const charged = 11_000 + shippingFor(11_000);
    assert.ok(!result.ok && result.stale, "recusa, e a borda recarrega a tela");
    assert.ok(result.message.includes(`O total mudou para ${formatPriceCents(charged)}`), result.message);
    assert.equal(await db.$count(orders), 0);

    // Confirmando com o total novo, fecha.
    assert.ok((await placeOrder(input(fixture, { expectedTotalCents: charged }))).ok);
  });

  it("cupom informado que deixou de valer: recusa, em vez de cobrar sem o desconto mostrado", async () => {
    const fixture = await seedCheckoutFixture({ coupon: { discountValue: 10 } });
    await db.update(coupons).set({ isActive: false }).where(eq(coupons.id, fixture.couponId!));

    const result = await placeOrder(input(fixture, { couponCode: fixture.couponCode! }));

    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.stale);
    assert.equal(await db.$count(orders), 0);
  });
});
