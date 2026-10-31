/**
 * Gateway de pagamento: o único ponto do sistema que fala com infraestrutura
 * externa. Roteia pelo token do meio de pagamento — o resto do serviço (e a
 * saga) não sabe qual provedor cobrou:
 *
 * - `pm_…` (cartão digitado no Stripe Elements) + Stripe configurado
 *   → Stripe, modo de teste (`stripe.ts`);
 * - token de teste (`sim_decline`, `sim_flaky_once`…) → provedor simulado no
 *   caminho pedido, só com o modo demonstração ligado NESTE processo — como
 *   os cartões de teste do Stripe, é um valor de token, não um campo
 *   especial do comando;
 * - sem token (Pix, boleto) → provedor simulado, aprovando.
 */

import { createHash } from "node:crypto";
import { PermanentError, RetryableError } from "@/shared/errors";
import { TEST_PAYMENT_TOKENS, type TestPaymentScenario } from "./contract";
import {
  STRIPE_PROVIDER,
  stripeCharge,
  stripeConfigFromEnv,
  stripeRefund,
  type FetchLike,
  type StripeConfig,
} from "./stripe";

export type ChargeInput = {
  amountCents: number;
  method: string;
  /** Mesma chave => mesma cobrança, no provedor e no nosso banco. */
  idempotencyKey: string;
  /** Tentativa atual do comando (usada pelo token `sim_flaky_once`). */
  attempt?: number;
  /** `pm_…` do Stripe, token de teste, ou nada (simulado). */
  paymentToken?: string;
  orderId?: string;
};

export type ChargeResult = {
  transactionId: string;
  provider: string;
  authorizedAt: Date;
};

export const PROVIDER = "simulado";

/** Dependências externas — os testes injetam um `fetch` falso e a config. */
export type GatewayDeps = {
  stripe: StripeConfig | null;
  fetch: FetchLike;
  /** Aceita token de teste? Só com o modo demonstração ligado no processo de pagamentos. */
  allowTestTokens?: boolean;
};

const defaultDeps = (): GatewayDeps => ({
  stripe: stripeConfigFromEnv(),
  fetch,
  allowTestTokens: process.env.ALLOW_CHECKOUT_SIMULATION === "1",
});

/** Cenário do provedor simulado pedido pelo token de teste, ou `null`. */
export function testScenarioOf(token: string | undefined): TestPaymentScenario | null {
  if (!token) return null;
  const entry = Object.entries(TEST_PAYMENT_TOKENS).find(([, value]) => value === token);
  return entry ? (entry[0] as TestPaymentScenario) : null;
}

/**
 * Quem processa cartão neste processo. Chamado na subida do worker: chave de
 * produção derruba o processo na hora, em vez de falhar na primeira compra.
 */
export function cardProvider(): typeof STRIPE_PROVIDER | typeof PROVIDER {
  return stripeConfigFromEnv() ? STRIPE_PROVIDER : PROVIDER;
}

export async function charge(input: ChargeInput, deps: GatewayDeps = defaultDeps()): Promise<ChargeResult> {
  const attempt = input.attempt ?? 1;
  const scenario = testScenarioOf(input.paymentToken);

  if (input.amountCents <= 0) {
    throw new PermanentError("invalid_amount", "Valor do pagamento inválido.", {
      amountCents: input.amountCents,
    });
  }

  if (scenario && !deps.allowTestTokens) {
    // Token de teste com cobrança de verdade: o cliente não pode escolher o
    // resultado da própria cobrança.
    throw new PermanentError("test_token_rejected", "Meio de pagamento inválido.");
  }

  const mode = scenario ?? "approve";

  if (mode === "decline") {
    throw new PermanentError("payment_declined", "Pagamento recusado pela operadora.", {
      idempotencyKey: input.idempotencyKey,
    });
  }

  if (mode === "unavailable" || (mode === "flaky_once" && attempt === 1)) {
    throw new RetryableError("gateway_unavailable", "Provedor de pagamento indisponível.", {
      attempt,
      mode,
    });
  }

  const cardToken = !scenario && input.paymentToken?.startsWith("pm_") ? input.paymentToken : undefined;
  if (input.paymentToken && !scenario && !cardToken) {
    throw new PermanentError("invalid_payment_token", "Meio de pagamento inválido.");
  }

  if (cardToken) {
    // O comprador digitou o cartão no Elements: sem Stripe aqui, não há como
    // cobrar — e cair no simulado aprovaria um cartão que ninguém validou.
    if (!deps.stripe) {
      throw new PermanentError("gateway_misconfigured", "Pagamento com cartão indisponível no momento.");
    }
    const result = await stripeCharge(
      deps.stripe,
      {
        amountCents: input.amountCents,
        paymentMethodId: cardToken,
        idempotencyKey: input.idempotencyKey,
        orderId: input.orderId,
      },
      deps.fetch,
    );
    return { ...result, provider: STRIPE_PROVIDER };
  }

  return {
    transactionId: transactionIdFor(input.idempotencyKey),
    provider: PROVIDER,
    authorizedAt: new Date(),
  };
}

export async function reverse(
  input: { transactionId: string | null; provider: string; idempotencyKey: string },
  deps: GatewayDeps = defaultDeps(),
): Promise<{ reversed: boolean }> {
  if (input.transactionId == null) return { reversed: false };

  if (input.provider === STRIPE_PROVIDER) {
    if (!deps.stripe) {
      // Cobrado no Stripe e sem chave para estornar: não dá para fingir.
      throw new RetryableError("gateway_misconfigured", "Stripe não configurado para estornar.");
    }
    return stripeRefund(
      deps.stripe,
      { paymentIntentId: input.transactionId, idempotencyKey: `${input.idempotencyKey}:refund` },
      deps.fetch,
    );
  }

  // Simulado: o estorno sempre funciona — o que importa para o exemplo é a saga
  // marcar o pagamento como estornado.
  return { reversed: true };
}

/** Id determinístico: a mesma chave de idempotência gera a mesma transação. */
export function transactionIdFor(idempotencyKey: string): string {
  const digest = createHash("sha1").update(idempotencyKey).digest("hex").slice(0, 12).toUpperCase();
  return `SIM-${digest}`;
}
