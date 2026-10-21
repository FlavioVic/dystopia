/**
 * Serviço de pedidos — responsabilidade única: criar o pedido e mover o
 * status dentro das transições permitidas.
 *
 * `createOrder` é a PRÉ-CONDIÇÃO da saga (o pedido nasce `pending` junto com
 * a saga e o job, na mesma transação). Os passos da saga só mudam estado.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { Executor } from "@/db";
import { addresses, orderItems, orders } from "@/db/schema";
import { canTransition, type OrderStatus } from "@/lib/order-status";
import { PermanentError } from "@/saga/errors";

export type OrderAddressInput = {
  recipientName: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
};

export type OrderLineInput = {
  productId: string;
  variantId: string | null;
  productNameSnapshot: string;
  unitPriceCents: number;
  quantity: number;
};

export type CreateOrderInput = {
  orderNumber: string;
  userId: string;
  address: OrderAddressInput;
  lines: OrderLineInput[];
  couponId: string | null;
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  totalCents: number;
};

export type CreateOrderResult = { orderId: string; addressId: string };

/** Número de pedido no formato DYS-<ano>-<6 dígitos>. Puro pra poder testar. */
export function generateOrderNumber(now: Date = new Date(), random: () => number = Math.random): string {
  const digits = String(Math.floor(random() * 1_000_000)).padStart(6, "0");
  return `DYS-${now.getFullYear()}-${digits}`;
}

export async function createOrder(executor: Executor, input: CreateOrderInput): Promise<CreateOrderResult> {
  if (input.lines.length === 0) {
    throw new PermanentError("empty_order", "Pedido sem itens.");
  }

  const [address] = await executor
    .insert(addresses)
    .values({ userId: input.userId, ...input.address })
    .returning({ id: addresses.id });

  const [order] = await executor
    .insert(orders)
    .values({
      orderNumber: input.orderNumber,
      userId: input.userId,
      status: "pending",
      shippingAddressId: address.id,
      billingAddressId: address.id,
      couponId: input.couponId,
      subtotalCents: input.subtotalCents,
      shippingCents: input.shippingCents,
      discountCents: input.discountCents,
      totalCents: input.totalCents,
    })
    .returning({ id: orders.id });

  await executor.insert(orderItems).values(
    input.lines.map((line) => ({
      orderId: order.id,
      productId: line.productId,
      variantId: line.variantId,
      productNameSnapshot: line.productNameSnapshot,
      unitPriceCents: line.unitPriceCents,
      quantity: line.quantity,
      totalCents: line.unitPriceCents * line.quantity,
    })),
  );

  return { orderId: order.id, addressId: address.id };
}

/**
 * Move o status respeitando a máquina de estados. Idempotente: pedir a
 * transição pro status atual não é erro (a saga pode ser reexecutada).
 */
export async function transitionOrder(
  executor: Executor,
  orderId: string,
  to: OrderStatus,
): Promise<{ changed: boolean; from: OrderStatus }> {
  const order = await executor.query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: { id: true, status: true },
  });
  if (!order) throw new PermanentError("order_not_found", "Pedido não encontrado.", { orderId });

  const from = order.status;
  if (from === to) return { changed: false, from };

  if (!canTransition(from, to)) {
    throw new PermanentError("invalid_order_transition", `Transição inválida: ${from} → ${to}.`, {
      orderId,
      from,
      to,
    });
  }

  await executor.update(orders).set({ status: to, updatedAt: new Date() }).where(eq(orders.id, orderId));
  return { changed: true, from };
}

/** Passo da saga: confirma o pagamento do pedido. */
export async function markOrderPaid(executor: Executor, orderId: string): Promise<{ changed: boolean }> {
  const { changed } = await transitionOrder(executor, orderId, "paid");
  return { changed };
}

/**
 * Compensação: cancela o pedido. Nunca lança por estado já terminal — a
 * compensação precisa ser segura de repetir.
 */
export async function markOrderCancelled(executor: Executor, orderId: string): Promise<{ changed: boolean }> {
  const cancelled = await executor
    .update(orders)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), inArray(orders.status, ["pending", "paid", "processing"])))
    .returning({ id: orders.id });
  return { changed: cancelled.length > 0 };
}
