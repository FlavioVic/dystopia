"use server";

/**
 * Server Actions do checkout.
 *
 * Esta camada é SÓ a borda HTTP: valida formulário, calcula totais no
 * servidor e abre a saga. Nenhuma regra de negócio mora aqui — quem reserva
 * estoque, cobra, consome cupom e avisa o cliente são os serviços em
 * `src/services/*`, orquestrados por `src/saga`.
 *
 * O commit inicial grava, numa única transação: endereço + pedido (`pending`)
 * + itens + saga + job da fila (outbox). Depois disso o avanço é tentado
 * inline (pro cliente já ver o resultado) e, se falhar, o worker termina.
 */

import { redirect } from "next/navigation";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/data/auth";
import { getCart } from "@/lib/data/cart";
import { shippingFor, type CouponResult } from "@/lib/shipping";
import { parseAddressForm } from "@/lib/validation/address";
import { CHECKOUT_SAGA_TYPE, type CheckoutSagaPayload } from "@/saga/definitions/checkout";
import { startSaga, tryRunSagaInline } from "@/saga/runner";
import { resolveCoupon } from "@/services/coupons";
import { createAddress, getUserAddress } from "@/services/addresses";
import { createOrder, generateOrderNumber } from "@/services/orders";
import { isPaymentMethod, type PaymentMethod } from "@/services/payments";
import { isSimulationMode } from "@/services/payments/gateway";
import { isCheckoutSimulationEnabled } from "@/lib/checkout-simulation";

const PAYMENT_METHODS = ["pix", "credit_card", "boleto"] as const satisfies readonly PaymentMethod[];

/** Server Action pública pro preview do cupom no checkout. */
export async function validateCoupon(code: string, subtotalCents: number): Promise<CouponResult> {
  const result = await resolveCoupon(db, code, subtotalCents);
  if (!result.ok) return { ok: false, message: result.message };
  return {
    ok: true,
    code: result.code,
    couponId: result.couponId,
    discountCents: result.discountCents,
    message: "Cupom aplicado!",
  };
}

export type CheckoutState =
  | {
      errors?: Record<string, string>;
      message?: string;
    }
  | undefined;

function req(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function placeOrder(_prev: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const user = await getCurrentUser();
  if (!user) redirect("/entrar");

  const cart = await getCart();
  if (!cart || cart.lines.length === 0) {
    return { message: "Seu carrinho está vazio." };
  }

  // --- endereço: um salvo na agenda ou um novo (que também é salvo) ---
  const savedAddressId = req(formData, "addressId");
  let address: { id: string } | null = null;

  if (savedAddressId) {
    const saved = await getUserAddress(db, user.id, savedAddressId);
    if (!saved) return { message: "Endereço não encontrado na sua conta." };
    address = { id: saved.id };
  }

  const parsedAddress = parseAddressForm(formData);
  if (!address && Object.keys(parsedAddress.errors).length > 0) {
    return { errors: parsedAddress.errors };
  }

  const method = req(formData, "paymentMethod");
  if (!isPaymentMethod(method) || !(PAYMENT_METHODS as readonly string[]).includes(method)) {
    return { message: "Escolha a forma de pagamento." };
  }

  // --- totais (recalculados no servidor, nunca vindos do cliente) ---
  const subtotalCents = cart.subtotalCents;
  const coupon = await resolveCoupon(db, req(formData, "couponCode"), subtotalCents);
  const discountCents = coupon.ok ? coupon.discountCents : 0;
  const shippingCents = shippingFor(subtotalCents);
  const totalCents = Math.max(0, subtotalCents - discountCents) + shippingCents;
  const orderNumber = generateOrderNumber();

  const lines = cart.lines.map((line) => ({
    productId: line.productId,
    variantId: line.variantId,
    name: line.variantName ? `${line.name} — ${line.variantName}` : line.name,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
  }));

  // --- commit inicial: pedido + saga + job, tudo ou nada (outbox) ---
  const { sagaId } = await db.transaction(async (tx) => {
    // Endereço novo entra na agenda do cliente — é o que alimenta
    // /conta/enderecos e o seletor do próximo checkout.
    const shippingAddressId =
      address?.id ?? (await createAddress(tx, user.id, parsedAddress.values)).id;

    const { orderId } = await createOrder(tx, {
      orderNumber,
      userId: user.id,
      shippingAddressId,
      couponId: coupon.ok ? coupon.couponId : null,
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
      userId: user.id,
      customerName: user.name,
      customerEmail: user.email,
      cartId: cart.id,
      paymentMethod: method,
      totalCents,
      couponId: coupon.ok ? coupon.couponId : null,
      lines,
      ...(simulationFromForm(formData) ? { simulate: simulationFromForm(formData)! } : {}),
    };

    return startSaga(tx, {
      type: CHECKOUT_SAGA_TYPE,
      correlationId: orderNumber,
      payload: payload as unknown as Record<string, unknown>,
    });
  });

  // Caminho rápido: tenta terminar a saga no próprio request pro cliente já
  // cair na página do pedido com o resultado. Se não der, o job na fila
  // garante que o worker termina (ver src/saga/runner.ts).
  await tryRunSagaInline(sagaId);

  redirect(`/pedido/${orderNumber}`);
}

/**
 * Permite forçar um caminho do gateway simulado (`decline`, `flaky_once`…)
 * pra demonstrar a compensação. Com o modo demonstração desligado, o campo do
 * formulário é ignorado (ver `lib/checkout-simulation`).
 */
function simulationFromForm(formData: FormData) {
  if (!isCheckoutSimulationEnabled()) return null;
  const raw = String(formData.get("simulate") ?? "");
  return isSimulationMode(raw) ? raw : null;
}
