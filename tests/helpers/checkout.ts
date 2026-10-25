/**
 * Monta um checkout igual ao que a Server Action monta (pedido `pending` +
 * saga + job na mesma transação), mas sem precisar de request HTTP.
 *
 * Os testes de integração usam isso para exercitar exatamente o caminho de
 * produção: `createOrder` + `startSaga` + `runSagaInline`/worker.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cartItems, coupons } from "@/db/schema";
import { shippingFor } from "@/lib/shipping";
import { CHECKOUT_SAGA_TYPE, type CheckoutSagaPayload } from "@/saga/definitions/checkout";
import { startSaga } from "@/saga/runner";
import { createAddress } from "@/services/addresses";
import { createOrder, generateOrderNumber } from "@/services/orders";
import { evaluateCoupon } from "@/services/coupons/rules";
import type { SimulationMode } from "@/services/payments/contract";
import type { CheckoutFixture } from "./db";

export type StartedCheckout = {
  sagaId: string;
  orderId: string;
  orderNumber: string;
  totalCents: number;
  subtotalCents: number;
  discountCents: number;
  lines: CheckoutSagaPayload["lines"];
};

export async function startCheckout(
  fixture: CheckoutFixture,
  options: { simulate?: SimulationMode; useCoupon?: boolean } = {},
): Promise<StartedCheckout> {
  const items = await db.query.cartItems.findMany({ where: eq(cartItems.cartId, fixture.cartId) });

  const lines: CheckoutSagaPayload["lines"] = items.map((item) => ({
    productId: item.productId,
    variantId: item.variantId,
    name: "Produto de teste",
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
  }));

  const subtotalCents = lines.reduce((total, line) => total + line.unitPriceCents * line.quantity, 0);

  let discountCents = 0;
  let couponId: string | null = null;
  if (options.useCoupon && fixture.couponId) {
    const coupon = await db.query.coupons.findFirst({ where: eq(coupons.id, fixture.couponId) });
    const evaluation = evaluateCoupon(coupon ?? null, subtotalCents, new Date());
    // Cupom esgotado/invalido ainda é anexado de propósito em alguns testes:
    // é assim que o passo `consume-coupon` falha e a saga compensa.
    couponId = fixture.couponId;
    discountCents = evaluation.ok ? evaluation.discountCents : 0;
  }

  const shippingCents = shippingFor(subtotalCents);
  const totalCents = Math.max(0, subtotalCents - discountCents) + shippingCents;
  const orderNumber = generateOrderNumber();

  const result = await db.transaction(async (tx) => {
    const address = await createAddress(tx, fixture.userId, {
      label: "Entrega",
      recipientName: "Cliente Teste",
      street: "Rua das Flores",
      number: "123",
      complement: null,
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
      zipCode: "01000-000",
    });

    const { orderId } = await createOrder(tx, {
      orderNumber,
      userId: fixture.userId,
      shippingAddressId: address.id,
      lines: lines.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        productNameSnapshot: line.name,
        unitPriceCents: line.unitPriceCents,
        quantity: line.quantity,
      })),
      couponId,
      subtotalCents,
      shippingCents,
      discountCents,
      totalCents,
    });

    const payload: CheckoutSagaPayload = {
      orderId,
      orderNumber,
      userId: fixture.userId,
      customerName: fixture.userName,
      customerEmail: fixture.userEmail,
      cartId: fixture.cartId,
      paymentMethod: "pix",
      totalCents,
      couponId,
      lines,
      ...(options.simulate ? { simulate: options.simulate } : {}),
    };

    const { sagaId } = await startSaga(tx, {
      type: CHECKOUT_SAGA_TYPE,
      correlationId: orderNumber,
      payload: payload as unknown as Record<string, unknown>,
    });

    return { sagaId, orderId };
  });

  return {
    sagaId: result.sagaId,
    orderId: result.orderId,
    orderNumber,
    totalCents,
    subtotalCents,
    discountCents,
    lines,
  };
}
