/**
 * Serviço de pedidos: criação (pré-condição da saga) e máquina de estados
 * aplicada no banco.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orderItems, orders } from "@/db/schema";
import { PermanentError } from "@/shared/errors";
import { createAddress } from "@/services/addresses";
import {
  createOrder,
  markOrderCancelled,
  markOrderPaid,
  transitionOrder,
} from "@/services/orders";
import { closeDatabase, resetDatabase, seedCheckoutFixture, type CheckoutFixture } from "../helpers/db";

beforeEach(resetDatabase);
after(closeDatabase);

const address = {
  label: "Entrega",
  recipientName: "Cliente Teste",
  street: "Rua das Flores",
  number: "123",
  complement: null,
  neighborhood: "Centro",
  city: "São Paulo",
  state: "SP",
  zipCode: "01000-000",
};

async function novoPedido(fixture: CheckoutFixture, quantity = 2) {
  const saved = await createAddress(db, fixture.userId, address);
  return createOrder(db, {
    orderNumber: `DYS-2026-${Math.floor(Math.random() * 1_000_000)}`,
    userId: fixture.userId,
    shippingAddressId: saved.id,
    couponId: null,
    subtotalCents: fixture.product.priceCents * quantity,
    shippingCents: 0,
    discountCents: 0,
    totalCents: fixture.product.priceCents * quantity,
    lines: [
      {
        productId: fixture.product.id,
        variantId: null,
        productNameSnapshot: "Produto de teste",
        unitPriceCents: fixture.product.priceCents,
        quantity,
      },
    ],
  });
}

describe("criação de pedido", () => {
  it("cria endereço, pedido pendente e itens com snapshot de preço", async () => {
    const fixture = await seedCheckoutFixture({ priceCents: 5_000 });
    const { orderId, addressId } = await novoPedido(fixture, 3);

    const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    assert.equal(order?.status, "pending", "o pedido nasce pendente — a saga confirma");
    assert.equal(order?.shippingAddressId, addressId);
    assert.equal(order?.billingAddressId, addressId);
    assert.equal(order?.totalCents, 15_000);

    const items = await db.query.orderItems.findMany({ where: eq(orderItems.orderId, orderId) });
    assert.equal(items.length, 1);
    assert.equal(items[0].unitPriceCents, 5_000);
    assert.equal(items[0].totalCents, 15_000, "total da linha calculado no serviço");
    assert.equal(items[0].productNameSnapshot, "Produto de teste");
  });

  it("recusa pedido sem itens", async () => {
    const fixture = await seedCheckoutFixture();
    const saved = await createAddress(db, fixture.userId, address);
    await assert.rejects(
      () =>
        createOrder(db, {
          orderNumber: "DYS-2026-000001",
          userId: fixture.userId,
          shippingAddressId: saved.id,
          couponId: null,
          subtotalCents: 0,
          shippingCents: 0,
          discountCents: 0,
          totalCents: 0,
          lines: [],
        }),
      (error: unknown) => error instanceof PermanentError && error.code === "empty_order",
    );
  });

  it("recusa pedido com endereço de outra pessoa", async () => {
    const dono = await seedCheckoutFixture();
    const intruso = await seedCheckoutFixture();
    const doDono = await createAddress(db, dono.userId, address);

    await assert.rejects(
      () =>
        createOrder(db, {
          orderNumber: "DYS-2026-000002",
          userId: intruso.userId,
          shippingAddressId: doDono.id,
          couponId: null,
          subtotalCents: 1_000,
          shippingCents: 0,
          discountCents: 0,
          totalCents: 1_000,
          lines: [
            {
              productId: intruso.product.id,
              variantId: null,
              productNameSnapshot: "Produto",
              unitPriceCents: 1_000,
              quantity: 1,
            },
          ],
        }),
      (error: unknown) => error instanceof PermanentError && error.code === "address_not_found",
    );
  });
});

describe("transições de status", () => {
  it("segue o caminho permitido", async () => {
    const fixture = await seedCheckoutFixture();
    const { orderId } = await novoPedido(fixture);

    assert.deepEqual(await transitionOrder(db, orderId, "paid"), { changed: true, from: "pending" });
    assert.deepEqual(await transitionOrder(db, orderId, "processing"), { changed: true, from: "paid" });
    assert.deepEqual(await transitionOrder(db, orderId, "shipped"), { changed: true, from: "processing" });
    assert.deepEqual(await transitionOrder(db, orderId, "delivered"), { changed: true, from: "shipped" });

    const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    assert.equal(order?.status, "delivered");
  });

  it("transição para o mesmo status é no-op (a saga pode ser reexecutada)", async () => {
    const fixture = await seedCheckoutFixture();
    const { orderId } = await novoPedido(fixture);

    await markOrderPaid(db, orderId);
    assert.deepEqual(await markOrderPaid(db, orderId), { changed: false });
  });

  it("recusa transição inválida sem alterar o pedido", async () => {
    const fixture = await seedCheckoutFixture();
    const { orderId } = await novoPedido(fixture);

    await assert.rejects(
      () => transitionOrder(db, orderId, "delivered"),
      (error: unknown) =>
        error instanceof PermanentError && error.code === "invalid_order_transition",
    );

    const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
    assert.equal(order?.status, "pending");
  });

  it("recusa pedido inexistente", async () => {
    await assert.rejects(
      () => transitionOrder(db, "00000000-0000-0000-0000-000000000000", "paid"),
      (error: unknown) => error instanceof PermanentError && error.code === "order_not_found",
    );
  });
});

describe("cancelamento (compensação)", () => {
  it("cancela pedido pendente e pago", async () => {
    const fixture = await seedCheckoutFixture();

    const pendente = await novoPedido(fixture);
    assert.deepEqual(await markOrderCancelled(db, pendente.orderId), { changed: true });

    const pago = await novoPedido(fixture);
    await markOrderPaid(db, pago.orderId);
    assert.deepEqual(await markOrderCancelled(db, pago.orderId), { changed: true });
  });

  it("é idempotente e não reabre pedido já entregue", async () => {
    const fixture = await seedCheckoutFixture();
    const { orderId } = await novoPedido(fixture);

    await markOrderCancelled(db, orderId);
    assert.deepEqual(await markOrderCancelled(db, orderId), { changed: false }, "repetir é seguro");

    const entregue = await novoPedido(fixture);
    await transitionOrder(db, entregue.orderId, "paid");
    await transitionOrder(db, entregue.orderId, "shipped");
    await transitionOrder(db, entregue.orderId, "delivered");

    assert.deepEqual(await markOrderCancelled(db, entregue.orderId), { changed: false });
    const order = await db.query.orders.findFirst({ where: eq(orders.id, entregue.orderId) });
    assert.equal(order?.status, "delivered");
  });
});
