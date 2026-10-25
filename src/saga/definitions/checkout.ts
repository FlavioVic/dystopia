/**
 * SAGA de checkout — a orquestração do pedido.
 *
 * O pedido nasce `pending` (junto com a saga e a mensagem, numa transação só) e
 * cada passo abaixo é atômico, de um serviço diferente:
 *
 *   1. reserve-stock      → inventory   | comp: devolve as unidades
 *   2. authorize-payment  → payments    | comp: estorna
 *   3. consume-coupon      → coupons    | comp: devolve o uso
 *   4. confirm-order      → orders      | comp: cancela o pedido
 *   5. clear-cart         → carts       | comp: restaura os itens
 *   6. notify-customer    → notifications (sem compensação: só avisa)
 *
 * Ordem pensada para o caminho triste: pagamento vem ANTES do cupom, então
 * pagamento recusado (o caso mais comum) compensa só o estoque.
 *
 * O pagamento é um passo REMOTO: o serviço de pagamentos roda em outro
 * processo (`npm run worker:payments`) e a saga fala com ele só por mensagem,
 * pelo contrato em services/payments/contract — cobrar e estornar são
 * comandos na fila `payments`, com a resposta voltando para a saga.
 */

import { PermanentError } from "@/saga/errors";
import type { SagaDefinition, SagaStep } from "@/saga/types";
import { clearCart, restoreCart } from "@/services/carts";
import { consumeCoupon, releaseCoupon } from "@/services/coupons";
import {
  isCardPaymentMethodId,
  isPaymentMethod,
  isSimulationMode,
  PAYMENT_AUTHORIZE,
  PAYMENT_REFUND,
  PAYMENTS_QUEUE,
  type AuthorizeCommand,
  type PaymentMethod,
  type RefundCommand,
  type SimulationMode,
} from "@/services/payments/contract";
import { markOrderCancelled, markOrderPaid } from "@/services/orders";
import { releaseStock, reserveStock } from "@/services/inventory";
import { sendOrderConfirmation } from "@/services/notifications";

export const CHECKOUT_SAGA_TYPE = "checkout";

export type CheckoutSagaLine = {
  productId: string;
  variantId: string | null;
  name: string;
  quantity: number;
  unitPriceCents: number;
};

export type CheckoutSagaPayload = {
  orderId: string;
  orderNumber: string;
  userId: string;
  customerName: string;
  customerEmail: string;
  cartId: string;
  paymentMethod: PaymentMethod;
  totalCents: number;
  couponId: string | null;
  lines: CheckoutSagaLine[];
  /** Só para demonstrar/testar os caminhos tristes do gateway simulado. */
  simulate?: SimulationMode;
  /** Cartão via Stripe Elements (`pm_…`). Não é dado de cartão: é um token do Stripe. */
  cardPaymentMethodId?: string;
};

/** Chave de idempotência do pagamento: estável entre tentativas do passo. */
export function paymentIdempotencyKey(orderNumber: string): string {
  return `order:${orderNumber}:payment`;
}

const steps: SagaStep<CheckoutSagaPayload>[] = [
  {
    name: "reserve-stock",
    invoke: async (ctx, tx) => {
      const result = await reserveStock(tx, ctx.payload.lines);
      return { reservedLines: result.reserved.length };
    },
    compensate: async (ctx, tx) => {
      await releaseStock(tx, ctx.payload.lines);
    },
  },
  {
    name: "authorize-payment",
    request: (ctx) => ({
      type: PAYMENT_AUTHORIZE,
      queue: PAYMENTS_QUEUE,
      payload: {
        orderId: ctx.payload.orderId,
        method: ctx.payload.paymentMethod,
        amountCents: ctx.payload.totalCents,
        idempotencyKey: paymentIdempotencyKey(ctx.payload.orderNumber),
        ...(ctx.payload.simulate ? { mode: ctx.payload.simulate } : {}),
        ...(ctx.payload.cardPaymentMethodId ? { cardPaymentMethodId: ctx.payload.cardPaymentMethodId } : {}),
      } satisfies AuthorizeCommand,
    }),
    compensateRequest: (ctx) => ({
      type: PAYMENT_REFUND,
      queue: PAYMENTS_QUEUE,
      payload: {
        orderId: ctx.payload.orderId,
        idempotencyKey: paymentIdempotencyKey(ctx.payload.orderNumber),
      } satisfies RefundCommand,
    }),
  },
  {
    name: "consume-coupon",
    skip: (ctx) => ctx.payload.couponId == null,
    invoke: async (ctx, tx) => {
      const couponId = ctx.payload.couponId;
      if (!couponId) return { skipped: true };
      const result = await consumeCoupon(tx, couponId);
      return { couponUsageCount: result.usageCount };
    },
    compensate: async (ctx, tx) => {
      if (ctx.payload.couponId) await releaseCoupon(tx, ctx.payload.couponId);
    },
  },
  {
    name: "confirm-order",
    invoke: async (ctx, tx) => {
      const result = await markOrderPaid(tx, ctx.payload.orderId);
      return { orderConfirmed: result.changed };
    },
    compensate: async (ctx, tx) => {
      await markOrderCancelled(tx, ctx.payload.orderId);
    },
  },
  {
    name: "clear-cart",
    invoke: async (ctx, tx) => {
      const result = await clearCart(tx, ctx.payload.cartId);
      return { cartItemsRemoved: result.removed };
    },
    compensate: async (ctx, tx) => {
      await restoreCart(
        tx,
        ctx.payload.cartId,
        ctx.payload.lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
        })),
      );
    },
  },
  {
    name: "notify-customer",
    invoke: async (ctx, tx) => {
      const result = await sendOrderConfirmation(tx, {
        orderNumber: ctx.payload.orderNumber,
        recipient: ctx.payload.customerEmail,
        customerName: ctx.payload.customerName,
        totalCents: ctx.payload.totalCents,
        items: ctx.payload.lines.map((line) => ({ name: line.name, quantity: line.quantity })),
      });
      return { notificationId: result.notificationId, duplicate: result.duplicate };
    },
  },
];

export const checkoutSaga: SagaDefinition<CheckoutSagaPayload> = {
  type: CHECKOUT_SAGA_TYPE,
  maxAttemptsPerStep: 3,
  steps,
  parsePayload: parseCheckoutPayload,
  onCompensated: async (ctx, tx) => {
    // Rede de segurança: mesmo que o passo `confirm-order` nunca tenha rodado,
    // o pedido não pode ficar preso em `pending`.
    await markOrderCancelled(tx, ctx.payload.orderId);
  },
};

// ---------------------------------------------------------------------------
// Validação do payload persistido (jsonb não tem tipo em runtime)
// ---------------------------------------------------------------------------

export function parseCheckoutPayload(raw: unknown): CheckoutSagaPayload {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw invalid("payload não é um objeto");
  }
  const data = raw as Record<string, unknown>;

  const payload: CheckoutSagaPayload = {
    orderId: str(data, "orderId"),
    orderNumber: str(data, "orderNumber"),
    userId: str(data, "userId"),
    customerName: str(data, "customerName"),
    customerEmail: str(data, "customerEmail"),
    cartId: str(data, "cartId"),
    paymentMethod: paymentMethod(data.paymentMethod),
    totalCents: int(data, "totalCents"),
    couponId: optionalStr(data.couponId),
    lines: lines(data.lines),
    ...(isSimulationMode(data.simulate) ? { simulate: data.simulate } : {}),
    ...(isCardPaymentMethodId(data.cardPaymentMethodId) ? { cardPaymentMethodId: data.cardPaymentMethodId } : {}),
  };

  if (payload.lines.length === 0) throw invalid("pedido sem itens");
  return payload;
}

function invalid(detail: string): PermanentError {
  return new PermanentError("invalid_payload", `Payload da saga inválido: ${detail}.`);
}

function str(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== "string" || value.length === 0) throw invalid(`${key} ausente`);
  return value;
}

function optionalStr(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || value.length === 0) throw invalid("id opcional inválido");
  return value;
}

function int(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalid(`${key} inválido`);
  return value;
}

function paymentMethod(value: unknown): PaymentMethod {
  if (!isPaymentMethod(value)) throw invalid("forma de pagamento inválida");
  return value;
}

function lines(value: unknown): CheckoutSagaLine[] {
  if (!Array.isArray(value)) throw invalid("lines não é uma lista");
  return value.map((raw) => {
    if (!raw || typeof raw !== "object") throw invalid("item inválido");
    const line = raw as Record<string, unknown>;
    const quantity = int(line, "quantity");
    if (quantity <= 0) throw invalid("quantidade inválida");
    return {
      productId: str(line, "productId"),
      variantId: optionalStr(line.variantId),
      name: str(line, "name"),
      quantity,
      unitPriceCents: int(line, "unitPriceCents"),
    };
  });
}
