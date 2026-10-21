/**
 * Provedor de pagamento SIMULADO.
 *
 * É o único ponto do sistema que finge ser infraestrutura externa. A troca
 * por um gateway real (Stripe, Mercado Pago) acontece aqui dentro, sem mexer
 * na saga: o contrato (`charge`/`reverse` + chave de idempotência) já é o que
 * um provedor real expõe.
 *
 * `mode` existe pra demonstrar/testar os caminhos tristes de forma
 * determinística — o padrão é aprovar.
 */

import { createHash } from "node:crypto";
import { PermanentError, RetryableError } from "@/saga/errors";

export const SIMULATION_MODES = ["approve", "decline", "flaky_once", "unavailable"] as const;
export type SimulationMode = (typeof SIMULATION_MODES)[number];

export function isSimulationMode(value: unknown): value is SimulationMode {
  return typeof value === "string" && (SIMULATION_MODES as readonly string[]).includes(value);
}

export type ChargeInput = {
  amountCents: number;
  method: string;
  /** Mesma chave => mesma cobrança, no provedor e no nosso banco. */
  idempotencyKey: string;
  mode?: SimulationMode;
  /** Tentativa atual do passo (usada pelo modo `flaky_once`). */
  attempt?: number;
};

export type ChargeResult = {
  transactionId: string;
  provider: string;
  authorizedAt: Date;
};

export const PROVIDER = "simulado";

export async function charge(input: ChargeInput): Promise<ChargeResult> {
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

  return {
    transactionId: transactionIdFor(input.idempotencyKey),
    provider: PROVIDER,
    authorizedAt: new Date(),
  };
}

export async function reverse(input: { transactionId: string | null }): Promise<{ reversed: boolean }> {
  // Num provedor real seria um POST /refunds. Aqui o estorno sempre funciona:
  // o que importa pro exemplo é a saga marcar o pagamento como estornado.
  return { reversed: input.transactionId != null };
}

/** Id determinístico: a mesma chave de idempotência gera a mesma transação. */
export function transactionIdFor(idempotencyKey: string): string {
  const digest = createHash("sha1").update(idempotencyKey).digest("hex").slice(0, 12).toUpperCase();
  return `SIM-${digest}`;
}
