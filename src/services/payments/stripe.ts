/**
 * Cliente mínimo da API do Stripe — `fetch` + form-encoding, sem SDK.
 *
 * O projeto evita dependência sem motivo forte, e o que usamos cabe em duas
 * chamadas REST estáveis: criar+confirmar o PaymentIntent e estornar.
 *
 * Idempotência: a nossa chave (`order:<n>:payment`) vai no header
 * `Idempotency-Key`. O Stripe guarda o resultado da 1ª requisição por 24 h e
 * devolve o MESMO resultado nas seguintes — inclusive um 500. Ou seja: retry
 * com a mesma chave nunca cobra duas vezes, mas também não "conserta" um 500
 * que o Stripe chegou a processar. Escolha consciente: segurança acima de
 * disponibilidade. Erro de rede (o Stripe nem recebeu) ou 429 não ficam
 * guardados, e esses o retry resolve.
 *
 * Só modo de TESTE: chave `sk_live_` é recusada. Cobrar de verdade pediria
 * revisão do fluxo (webhooks, 3D Secure, dados do comprador, conciliação).
 */

import { PermanentError, RetryableError } from "@/saga/errors";

export const STRIPE_PROVIDER = "stripe";
const API = "https://api.stripe.com/v1";
const TIMEOUT_MS = 15_000;

export type StripeConfig = { secretKey: string };
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Lê a chave do ambiente. Sem chave = Stripe desligado (usa o simulado). */
export function stripeConfigFromEnv(env: Record<string, string | undefined> = process.env): StripeConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) return null;
  if (!secretKey.startsWith("sk_test_") && !secretKey.startsWith("rk_test_")) {
    throw new Error(
      "STRIPE_SECRET_KEY precisa ser de modo de teste (sk_test_…). Este projeto é demonstração e se recusa a cobrar de verdade.",
    );
  }
  return { secretKey };
}

export type StripeChargeInput = {
  amountCents: number;
  /** `pm_…` criado no navegador pelo Stripe Elements. */
  paymentMethodId: string;
  idempotencyKey: string;
  orderId?: string;
};

export type StripeChargeResult = { transactionId: string; authorizedAt: Date };

export async function stripeCharge(
  config: StripeConfig,
  input: StripeChargeInput,
  fetchImpl: FetchLike = fetch,
): Promise<StripeChargeResult> {
  const intent = await call(config, fetchImpl, "payment_intents", input.idempotencyKey, {
    amount: String(input.amountCents),
    currency: "brl",
    payment_method: input.paymentMethodId,
    confirm: "true",
    // Só cartão, sem redirecionamento: a saga confirma no servidor, sem a
    // volta do navegador que um método com redirect exigiria.
    "automatic_payment_methods[enabled]": "true",
    "automatic_payment_methods[allow_redirects]": "never",
    ...(input.orderId ? { "metadata[order_id]": input.orderId } : {}),
  });

  const id = typeof intent.id === "string" ? intent.id : "";
  switch (intent.status) {
    case "succeeded":
      return { transactionId: id, authorizedAt: new Date() };
    case "requires_action":
      throw new PermanentError(
        "authentication_required",
        "Esse cartão pede autenticação (3D Secure), que esta demonstração não faz. Use 4242 4242 4242 4242.",
        { paymentIntent: id },
      );
    default:
      throw new PermanentError("payment_declined", "O Stripe não aprovou o pagamento.", {
        paymentIntent: id,
        status: intent.status,
      });
  }
}

/** Estorna o PaymentIntent inteiro. Já estornado conta como sucesso. */
export async function stripeRefund(
  config: StripeConfig,
  input: { paymentIntentId: string; idempotencyKey: string },
  fetchImpl: FetchLike = fetch,
): Promise<{ reversed: boolean }> {
  try {
    await call(config, fetchImpl, "refunds", input.idempotencyKey, { payment_intent: input.paymentIntentId });
    return { reversed: true };
  } catch (error) {
    if (error instanceof PermanentError && error.details?.stripeCode === "charge_already_refunded") {
      return { reversed: true };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------

type StripeError = { type?: string; code?: string; decline_code?: string; message?: string };

async function call(
  config: StripeConfig,
  fetchImpl: FetchLike,
  path: string,
  idempotencyKey: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchImpl(`${API}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": idempotencyKey,
      },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // Nem chegou resposta: o Stripe pode não ter recebido — o retry resolve.
    throw new RetryableError("gateway_unavailable", "O Stripe não respondeu.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok) return body;
  throw toSagaError(response.status, (body.error ?? {}) as StripeError);
}

/** Erro do Stripe → taxonomia da saga (o que compensa já vs o que tenta de novo). */
export function toSagaError(status: number, error: StripeError): Error {
  const details = { httpStatus: status, stripeCode: error.code, declineCode: error.decline_code };

  if (status === 429 || status >= 500) {
    return new RetryableError("gateway_unavailable", "O Stripe está indisponível no momento.", details);
  }
  if (error.type === "card_error") {
    // processing_error é falha do processador, não do cartão: vale tentar de novo.
    if (error.code === "processing_error") {
      return new RetryableError("gateway_unavailable", "Falha temporária ao processar o cartão.", details);
    }
    return new PermanentError("payment_declined", declineMessage(error.decline_code ?? error.code), details);
  }
  if (status === 401 || status === 403) {
    return new PermanentError("gateway_misconfigured", "Chave do Stripe inválida ou sem permissão.", details);
  }
  if (status === 409) {
    return new PermanentError("idempotency_conflict", "Requisição repetida com dados diferentes.", details);
  }
  return new PermanentError("payment_invalid", error.message ?? "O Stripe recusou a requisição.", details);
}

function declineMessage(code: string | undefined): string {
  switch (code) {
    case "insufficient_funds":
      return "Cartão sem saldo suficiente.";
    case "expired_card":
      return "Cartão vencido.";
    case "incorrect_cvc":
      return "Código de segurança incorreto.";
    case "incorrect_number":
    case "invalid_number":
      return "Número de cartão inválido.";
    default:
      return "Cartão recusado pelo banco emissor.";
  }
}
