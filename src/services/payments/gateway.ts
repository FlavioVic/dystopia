/**
 * Gateway de pagamento: o único ponto do sistema que fala com infraestrutura
 * externa. Roteia por provedor — o resto do serviço (e a saga) não sabe qual:
 *
 * - cartão com `pm_…` (Stripe Elements no navegador) + Stripe configurado
 *   → Stripe, modo de teste (`stripe.ts`);
 * - o resto (Pix, boleto, cartão sem Stripe) → provedor SIMULADO.
 *
 * `mode` é o modo demonstração: injeta a falha ANTES de qualquer provedor,
 * pra mostrar os caminhos tristes de forma determinística (o Stripe não tem
 * como simular "fora do ar"). Recusa de verdade no Stripe vem do cartão
 * 4000 0000 0000 0002.
 */

import { createHash } from "node:crypto";
import { PermanentError, RetryableError } from "@/saga/errors";
import type { SimulationMode } from "./contract";
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
  mode?: SimulationMode;
  /** Tentativa atual do passo (usada pelo modo `flaky_once`). */
  attempt?: number;
  /** PaymentMethod do Stripe criado no navegador (`pm_…`). */
  cardPaymentMethodId?: string;
  orderId?: string;
};

export type ChargeResult = {
  transactionId: string;
  provider: string;
  authorizedAt: Date;
};

export const PROVIDER = "simulado";

/** Dependências externas — os testes injetam um `fetch` falso e a config. */
export type GatewayDeps = { stripe: StripeConfig | null; fetch: FetchLike };

const defaultDeps = (): GatewayDeps => ({ stripe: stripeConfigFromEnv(), fetch });

/**
 * Quem processa cartão neste processo. Chamado na subida do worker: chave de
 * produção derruba o processo na hora, em vez de falhar na primeira compra.
 */
export function cardProvider(): typeof STRIPE_PROVIDER | typeof PROVIDER {
  return stripeConfigFromEnv() ? STRIPE_PROVIDER : PROVIDER;
}

export async function charge(input: ChargeInput, deps: GatewayDeps = defaultDeps()): Promise<ChargeResult> {
  const mode = input.mode ?? "approve";
  const attempt = input.attempt ?? 1;

  if (input.amountCents <= 0) {
    throw new PermanentError("invalid_amount", "Valor do pagamento inválido.", {
      amountCents: input.amountCents,
    });
  }

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

  if (input.cardPaymentMethodId) {
    // O comprador digitou o cartão no Elements: sem Stripe aqui, não há como
    // cobrar — e cair no simulado aprovaria um cartão que ninguém validou.
    if (!deps.stripe) {
      throw new PermanentError("gateway_misconfigured", "Pagamento com cartão indisponível no momento.");
    }
    const result = await stripeCharge(
      deps.stripe,
      {
        amountCents: input.amountCents,
        paymentMethodId: input.cardPaymentMethodId,
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
      // Cobrado no Stripe e sem chave pra estornar: não dá pra fingir.
      throw new RetryableError("gateway_misconfigured", "Stripe não configurado para estornar.");
    }
    return stripeRefund(
      deps.stripe,
      { paymentIntentId: input.transactionId, idempotencyKey: `${input.idempotencyKey}:refund` },
      deps.fetch,
    );
  }

  // Simulado: o estorno sempre funciona — o que importa pro exemplo é a saga
  // marcar o pagamento como estornado.
  return { reversed: true };
}

/** Id determinístico: a mesma chave de idempotência gera a mesma transação. */
export function transactionIdFor(idempotencyKey: string): string {
  const digest = createHash("sha1").update(idempotencyKey).digest("hex").slice(0, 12).toUpperCase();
  return `SIM-${digest}`;
}
