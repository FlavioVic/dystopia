/**
 * SAGA de checkout — a orquestração do pedido (versão 2).
 *
 * O pedido nasce `pending` (junto com a saga e a mensagem, numa transação só) e
 * cada passo abaixo é atômico, de um serviço diferente:
 *
 *   1. reserve-stock      → inventory      compensável | devolve as unidades
 *   2. consume-coupon     → coupons        compensável | devolve o uso
 *   3. authorize-payment  → payments       PIVÔ (o ponto sem volta)
 *   4. confirm-order      → orders         retentável
 *   5. clear-cart         → carts          retentável
 *   6. notify-customer    → notifications  retentável
 *
 * A ordem segue o custo de desfazer. Devolver estoque e cupom é barato e
 * interno; estornar uma cobrança custa taxa e aparece na fatura do cliente.
 * Então tudo que pode falhar por regra (sem estoque, cupom esgotado) vem ANTES
 * da cobrança, e a cobrança é o pivô: recusada, desfaz cupom e estoque; aprovada,
 * a saga TEM que terminar. Os passos depois dela não desistem — tentam de novo
 * e, se não andarem, a saga para em `halted` para alguém retomar. Pedido
 * pago nunca é estornado por um erro de confirmação.
 *
 * O pagamento é um passo REMOTO: o serviço de pagamentos roda em outro
 * processo (`npm run worker:payments`) e a saga fala com ele só por mensagem,
 * pelo contrato em services/payments/contract.
 *
 * A versão 1 (cupom depois do pagamento, tudo compensável) está em
 * `checkout.v1.ts`, para as sagas que começaram nela terminarem nela.
 */

import { PermanentError } from "@/shared/errors";
import type { LocalStepBody, RemoteStepBody, SagaDefinition, StepContext } from "@/saga/types";
import { clearCart } from "@/services/carts";
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

// Passos do checkout, sem papel: cada versão da saga diz o papel de cada um.
// A compensação mora em constante separada porque só vale onde o passo é compensável.

type LocalStep = LocalStepBody<CheckoutSagaPayload>;
type Context = StepContext<CheckoutSagaPayload>;

export const reserveStockStep = {
  name: "reserve-stock",
  invoke: async (ctx, tx) => {
    const result = await reserveStock(tx, ctx.payload.lines);
    return { reservedLines: result.reserved.length };
  },
  compensate: async (ctx, tx) => {
    await releaseStock(tx, ctx.payload.lines);
  },
} satisfies LocalStep;

export const consumeCouponStep = {
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
} satisfies LocalStep;

export const authorizePaymentStep = {
  name: "authorize-payment",
  request: (ctx: Context) => ({
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
} satisfies RemoteStepBody<CheckoutSagaPayload>;

/** Estorno: só existe na v1, em que o pagamento ainda era compensável. */
export function refundPaymentRequest(ctx: Context) {
  return {
    type: PAYMENT_REFUND,
    queue: PAYMENTS_QUEUE,
    payload: {
      orderId: ctx.payload.orderId,
      idempotencyKey: paymentIdempotencyKey(ctx.payload.orderNumber),
    } satisfies RefundCommand,
  };
}

export const confirmOrderStep = {
  name: "confirm-order",
  invoke: async (ctx, tx) => {
    const result = await markOrderPaid(tx, ctx.payload.orderId);
    return { orderConfirmed: result.changed };
  },
} satisfies LocalStep;

export const clearCartStep = {
  name: "clear-cart",
  invoke: async (ctx, tx) => {
    const result = await clearCart(tx, ctx.payload.cartId);
    return { cartItemsRemoved: result.removed };
  },
} satisfies LocalStep;

export const notifyCustomerStep = {
  name: "notify-customer",
  invoke: async (ctx, tx) => {
    const result = await sendOrderConfirmation(tx, {
      orderNumber: ctx.payload.orderNumber,
      recipient: ctx.payload.customerEmail,
      customerName: ctx.payload.customerName,
      totalCents: ctx.payload.totalCents,
      paymentMethod: ctx.payload.paymentMethod,
      items: ctx.payload.lines.map((line) => ({ name: line.name, quantity: line.quantity, unitPriceCents: line.unitPriceCents })),
    });
    return { notificationId: result.notificationId, duplicate: result.duplicate };
  },
} satisfies LocalStep;

/** Rede de segurança do caminho triste, igual nas duas versões. */
export const cancelOrderOnCompensated: SagaDefinition<CheckoutSagaPayload>["onCompensated"] = async (ctx, tx) => {
  // Mesmo que o passo `confirm-order` nunca tenha rodado, o pedido não pode
  // ficar preso em `pending`.
  await markOrderCancelled(tx, ctx.payload.orderId);
};

export const checkoutSaga: SagaDefinition<CheckoutSagaPayload> = {
  type: CHECKOUT_SAGA_TYPE,
  version: 2,
  maxAttemptsPerStep: 3,
  steps: [
    { ...reserveStockStep, kind: "compensatable" },
    { ...consumeCouponStep, kind: "compensatable" },
    { ...authorizePaymentStep, kind: "pivot" },
    { ...confirmOrderStep, kind: "retriable" },
    { ...clearCartStep, kind: "retriable" },
    { ...notifyCustomerStep, kind: "retriable" },
  ],
  parsePayload: parseCheckoutPayload,
  describeFailure: describeCheckoutFailure,
  onCompensated: cancelOrderOnCompensated,
};

/** Mensagem curta para o cliente final — sem vazar detalhe de infraestrutura. */
export function describeCheckoutFailure(code: string): string {
  switch (code) {
    case "out_of_stock":
      return "Um item do pedido ficou sem estoque.";
    case "payment_declined":
      return "O pagamento foi recusado pela operadora.";
    case "coupon_exhausted":
      return "O cupom usado esgotou antes da confirmação.";
    case "invalid_payload":
      return "Os dados do pedido ficaram inconsistentes.";
    default:
      return "Não foi possível concluir o pedido.";
  }
}

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
