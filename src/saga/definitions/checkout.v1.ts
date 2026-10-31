/**
 * SAGA de checkout, versão 1 — só para as sagas que começaram nela.
 *
 * Ordem antiga: reservar estoque → cobrar → cupom → confirmar → carrinho →
 * avisar, com TODOS os passos compensáveis. Cupom esgotado depois da cobrança
 * virava cobrança + estorno, e um erro de regra depois do pagamento estornava
 * um pedido legítimo — por isso a v2 (checkout.ts) trocou a ordem e fez da
 * cobrança o pivô.
 *
 * Uma saga termina na versão com que começou: mudar a ordem com saga em
 * andamento faria `current_step` apontar para o passo errado. Esta definição
 * sai do registry quando não houver mais saga v1 rodando.
 */

import { describeCancellation } from "@/lib/order-status";
import { restoreCart } from "@/services/carts";
import { markOrderCancelled } from "@/services/orders";
import type { SagaDefinition } from "@/saga/types";
import {
  authorizePaymentStep,
  cancelOrderOnCompensated,
  CHECKOUT_SAGA_TYPE,
  clearCartStep,
  confirmOrderStep,
  consumeCouponStep,
  notifyCustomerStep,
  parseCheckoutPayload,
  refundPaymentRequest,
  reserveStockStep,
  type CheckoutSagaPayload,
} from "./checkout";

export const checkoutSagaV1: SagaDefinition<CheckoutSagaPayload> = {
  type: CHECKOUT_SAGA_TYPE,
  version: 1,
  maxAttemptsPerStep: 3,
  steps: [
    { ...reserveStockStep, kind: "compensatable" },
    { ...authorizePaymentStep, kind: "compensatable", compensateRequest: refundPaymentRequest },
    { ...consumeCouponStep, kind: "compensatable" },
    {
      ...confirmOrderStep,
      kind: "compensatable",
      compensate: async (ctx, tx) => {
        await markOrderCancelled(tx, ctx.payload.orderId);
      },
    },
    {
      ...clearCartStep,
      kind: "compensatable",
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
    { ...notifyCustomerStep, kind: "compensatable" },
  ],
  parsePayload: parseCheckoutPayload,
  describeFailure: describeCancellation,
  onCompensated: cancelOrderOnCompensated,
};
