/**
 * Caso de uso: fechar a compra.
 *
 * A borda (Server Action) entrega a entrada já validada — quem é o cliente
 * (da sessão), qual carrinho (do cookie), endereço e forma de pagamento — e
 * recebe o número do pedido. A regra mora aqui: limite de tentativas, totais
 * recalculados no servidor com o preço ATUAL do catálogo e o commit inicial,
 * numa transação só: endereço novo, pedido `pending` e a saga com a primeira
 * mensagem (outbox).
 *
 * O cliente nunca paga um total que não viu: a tela manda o total que mostrou
 * e, se o recalculado for outro (preço mudou no painel, cupom acabou), a
 * compra é recusada com o valor novo para ele confirmar. O número da tela só
 * serve para essa comparação — o que se cobra é sempre o do servidor.
 *
 * Não executa passo nenhum da saga: quem leva o pedido até o fim é o
 * consumidor da fila. `afterCommit` só avisa que há trabalho novo — a raiz de
 * composição decide o que isso quer dizer (nada, com worker de pé; um dreno
 * depois da resposta, no deploy só-Vercel).
 */

import { db } from "@/db";
import { limitAction } from "@/lib/action-limits";
import { formatPriceCents } from "@/lib/format";
import { shippingFor } from "@/lib/shipping";
import type { AddressFormValues } from "@/lib/validation/address";
import { CHECKOUT_SAGA_TYPE, type CheckoutSagaPayload } from "@/saga/definitions/checkout";
import { startSaga } from "@/saga/runner";
import { createAddress, getUserAddress } from "@/services/addresses";
import { getCheckoutLines } from "@/services/carts";
import { resolveCoupon } from "@/services/coupons";
import { createOrder, generateOrderNumber } from "@/services/orders";
import type { PaymentMethod } from "@/services/payments/contract";
import type { UseCaseHooks } from "./hooks";

export type PlaceOrderInput = {
  /** Da sessão, nunca do formulário. */
  customer: { id: string; name: string; email: string };
  cartId: string;
  /** Um endereço salvo da agenda ou os dados de um novo (que também é salvo). */
  address: { savedId: string } | { values: AddressFormValues };
  paymentMethod: PaymentMethod;
  couponCode: string;
  /**
   * Token do meio de pagamento, opaco: `pm_…` (cartão no Stripe Elements) ou
   * token de teste do modo demonstração. Quem decide o que ele vale é pagamentos.
   */
  paymentToken?: string;
  /** Total que a tela mostrou. Só para comparar com o recalculado — nunca é cobrado. */
  expectedTotalCents?: number;
};

export type PlaceOrderResult =
  | { ok: true; orderNumber: string }
  /** `stale`: o que a tela mostra ficou velho (preço mudou) — a borda recarrega os dados. */
  | { ok: false; message: string; stale?: boolean };

export async function placeOrder(input: PlaceOrderInput, hooks: UseCaseHooks = {}): Promise<PlaceOrderResult> {
  const { customer } = input;

  const cartLines = await getCheckoutLines(db, input.cartId);
  if (cartLines.length === 0) return { ok: false, message: "Seu carrinho está vazio." };

  const unavailable = cartLines.filter((line) => !line.available).map((line) => `“${line.name}”`);
  if (unavailable.length > 0) {
    const list = unavailable.join(", ");
    return {
      ok: false,
      message: `${list} ${unavailable.length === 1 ? "saiu" : "saíram"} de venda. Tire do carrinho para concluir a compra.`,
    };
  }
  const lines = cartLines.map(({ available: _available, ...line }) => line);

  if ("savedId" in input.address && !(await getUserAddress(db, customer.id, input.address.savedId))) {
    return { ok: false, message: "Endereço não encontrado na sua conta." };
  }

  // Conta a tentativa com carrinho e endereço válidos — antes do cupom, para
  // o checkout não virar um jeito de testar códigos sem limite.
  const limited = await limitAction("checkout", `user:${customer.id}`);
  if (limited) return { ok: false, message: limited };

  // --- totais (recalculados no servidor, nunca vindos do cliente) ---
  const subtotalCents = lines.reduce((total, line) => total + line.unitPriceCents * line.quantity, 0);
  const coupon = await resolveCoupon(db, input.couponCode, subtotalCents);
  // Código informado e que não vale mais: recusa, em vez de cobrar sem o
  // desconto que a pessoa viu na tela.
  if (input.couponCode.trim() && !coupon.ok) return { ok: false, message: coupon.message, stale: true };
  const discountCents = coupon.ok ? coupon.discountCents : 0;
  const shippingCents = shippingFor(subtotalCents);
  const totalCents = Math.max(0, subtotalCents - discountCents) + shippingCents;

  if (input.expectedTotalCents !== undefined && input.expectedTotalCents !== totalCents) {
    return {
      ok: false,
      message: `O total mudou para ${formatPriceCents(totalCents)}: um preço do carrinho foi atualizado. Confira o resumo e confirme de novo.`,
      stale: true,
    };
  }

  const orderNumber = generateOrderNumber();
  const couponId = coupon.ok ? coupon.couponId : null;

  // --- commit inicial: pedido + saga + mensagem, tudo ou nada (outbox) ---
  await db.transaction(async (tx) => {
    // Endereço novo entra na agenda do cliente — é o que alimenta
    // /conta/enderecos e o seletor do próximo checkout.
    const shippingAddressId =
      "savedId" in input.address ? input.address.savedId : (await createAddress(tx, customer.id, input.address.values)).id;

    const { orderId } = await createOrder(tx, {
      orderNumber,
      userId: customer.id,
      shippingAddressId,
      couponId,
      subtotalCents,
      shippingCents,
      discountCents,
      totalCents,
      lines: lines.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        productNameSnapshot: line.name,
        unitPriceCents: line.unitPriceCents,
        quantity: line.quantity,
      })),
    });

    const payload: CheckoutSagaPayload = {
      orderId,
      orderNumber,
      userId: customer.id,
      customerName: customer.name,
      customerEmail: customer.email,
      cartId: input.cartId,
      paymentMethod: input.paymentMethod,
      totalCents,
      couponId,
      lines,
      ...(input.paymentToken ? { paymentToken: input.paymentToken } : {}),
    };

    await startSaga(tx, {
      type: CHECKOUT_SAGA_TYPE,
      correlationId: orderNumber,
      payload: payload as unknown as Record<string, unknown>,
    });
  });

  hooks.afterCommit?.();
  return { ok: true, orderNumber };
}
