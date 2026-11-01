"use server";

/**
 * Server Actions do checkout — só a borda HTTP: lê e valida o formulário,
 * descobre quem é o cliente (sessão) e qual o carrinho (cookie), e chama o
 * caso de uso (`src/application/checkout.ts`). Regra de negócio, saga e fila
 * não moram aqui.
 */

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { placeOrder as placeOrderUseCase } from "@/composition/web";
import { getCurrentUser } from "@/lib/data/auth";
import { getCartToken } from "@/lib/data/cart";
import type { CouponResult } from "@/lib/shipping";
import { parseAddressForm, type AddressFormValues } from "@/lib/validation/address";
import { findCartIdByToken } from "@/services/carts";
import { resolveCoupon } from "@/services/coupons";
import {
  isCardPaymentMethodId,
  isPaymentMethod,
  isTestPaymentScenario,
  TEST_PAYMENT_TOKENS,
  type PaymentMethod,
} from "@/services/payments/contract";
import { getStripePublishableKey } from "@/lib/stripe-public";
import { isCheckoutSimulationEnabled } from "@/lib/checkout-simulation";
import { limitAction } from "@/lib/action-limits";
import { getRequestIp } from "@/lib/request-ip";

const PAYMENT_METHODS = ["pix", "credit_card", "boleto"] as const satisfies readonly PaymentMethod[];

/** Server Action pública para o preview do cupom no checkout. */
export async function validateCoupon(code: string, subtotalCents: number): Promise<CouponResult> {
  const limited = await limitAction("coupon", `ip:${await getRequestIp()}`);
  if (limited) return { ok: false, message: limited };
  const result = await resolveCoupon(db, code, subtotalCents);
  if (!result.ok) return { ok: false, message: result.message };
  // Só o que a tela mostra: o id interno do cupom não sai do servidor.
  return {
    ok: true,
    code: result.code,
    discountCents: result.discountCents,
    message: "Diretiva aplicada.",
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

  const cartToken = await getCartToken();
  const cartId = cartToken ? await findCartIdByToken(db, cartToken) : null;
  if (!cartId) return { message: "Seu carrinho está vazio." };

  // --- endereço: um salvo na agenda ou um novo (que também é salvo) ---
  // Ou o id de um salvo, ou os dados de um novo — nunca os dois em aberto.
  let address: { savedId: string } | { values: AddressFormValues };
  const savedAddressId = req(formData, "addressId");
  if (savedAddressId) {
    address = { savedId: savedAddressId };
  } else {
    const parsedAddress = parseAddressForm(formData);
    if (!parsedAddress.ok) return { errors: parsedAddress.errors };
    address = { values: parsedAddress.values };
  }

  const method = req(formData, "paymentMethod");
  if (!isPaymentMethod(method) || !(PAYMENT_METHODS as readonly string[]).includes(method)) {
    return { message: "Escolha a forma de pagamento." };
  }

  // Cartão com Stripe ligado: o navegador manda só o token (`pm_…`) criado
  // pelo Elements — número do cartão nunca chega aqui.
  let cardPaymentMethodId: string | undefined;
  if (method === "credit_card" && getStripePublishableKey()) {
    const token = req(formData, "cardPaymentMethodId");
    if (!isCardPaymentMethodId(token)) return { message: "Preencha os dados do cartão." };
    cardPaymentMethodId = token;
  }

  // Modo demonstração: o caminho escolhido vira token de teste do provedor
  // simulado (como um cartão de teste do Stripe). "Aprovar" segue o meio real.
  const simulate = simulationFromForm(formData);
  const paymentToken = simulate && simulate !== "approve" ? TEST_PAYMENT_TOKENS[simulate] : cardPaymentMethodId;
  // O total que a tela mostrou: o caso de uso só compara (nunca cobra isto).
  const expectedTotalCents = Number(req(formData, "expectedTotalCents"));
  const result = await placeOrderUseCase({
    customer: { id: user.id, name: user.name, email: user.email },
    cartId,
    address,
    paymentMethod: method,
    couponCode: req(formData, "couponCode"),
    ...(paymentToken ? { paymentToken } : {}),
    ...(Number.isSafeInteger(expectedTotalCents) && expectedTotalCents >= 0 ? { expectedTotalCents } : {}),
  });
  if (!result.ok) {
    // Preço mudou: a página recarrega os dados para mostrar o total novo.
    if (result.stale) refresh();
    return { message: result.message };
  }

  redirect(`/pedido/${result.orderNumber}`);
}

/**
 * Permite forçar um caminho do gateway simulado (`decline`, `flaky_once`…)
 * para demonstrar a compensação. Com o modo demonstração desligado, o campo do
 * formulário é ignorado (ver `lib/checkout-simulation`) — e o processo de
 * pagamentos recusa token de teste de qualquer jeito.
 */
function simulationFromForm(formData: FormData) {
  if (!isCheckoutSimulationEnabled()) return null;
  const raw = String(formData.get("simulate") ?? "");
  return isTestPaymentScenario(raw) ? raw : null;
}
