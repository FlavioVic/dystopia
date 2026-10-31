/**
 * Cliente mínimo da API do Resend — `fetch` + JSON, sem SDK (uma chamada só).
 *
 * Idempotência: a `dedupe_key` da notificação vai no header `Idempotency-Key`,
 * então o retry da fila nunca manda o mesmo e-mail duas vezes.
 */

import { PermanentError, RetryableError } from "@/shared/errors";

export const RESEND_PROVIDER = "resend";
const API = "https://api.resend.com/emails";
const TIMEOUT_MS = 15_000;
// Remetente de teste do Resend: funciona sem domínio próprio, mas só entrega
// no e-mail do dono da conta — casa com o modo sandbox (EMAIL_REDIRECT_TO).
const DEFAULT_FROM = "Dystopia <onboarding@resend.dev>";

export type EmailConfig = {
  apiKey: string;
  from: string;
  /** Modo sandbox: todo e-mail vai para cá, com o destinatário original no assunto. */
  redirectTo: string | null;
};

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Lê a config do ambiente. Sem `RESEND_API_KEY` = entrega simulada.
 *
 * Com chave, exige `EMAIL_REDIRECT_TO` — a não ser que `EMAIL_DELIVER_TO_RECIPIENTS=1`
 * libere de propósito. Numa demo pública, qualquer um se cadastra com o
 * e-mail de outra pessoa; entregar para o comprador por descuido vira spam com o
 * nome do projeto.
 */
export function emailConfigFromEnv(env: Record<string, string | undefined> = process.env): EmailConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;

  const redirectTo = env.EMAIL_REDIRECT_TO?.trim() || null;
  if (redirectTo && !EMAIL_RE.test(redirectTo)) {
    throw new Error("EMAIL_REDIRECT_TO não é um e-mail válido.");
  }
  if (!redirectTo && env.EMAIL_DELIVER_TO_RECIPIENTS !== "1") {
    throw new Error(
      "RESEND_API_KEY definida sem EMAIL_REDIRECT_TO: defina o e-mail que recebe tudo (modo sandbox) " +
        "ou EMAIL_DELIVER_TO_RECIPIENTS=1 para entregar ao comprador de verdade.",
    );
  }
  return { apiKey, from: env.EMAIL_FROM?.trim() || DEFAULT_FROM, redirectTo };
}

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
};

/** Envia e devolve o id do Resend. */
export async function resendSend(config: EmailConfig, email: OutgoingEmail, fetchImpl: FetchLike = fetch): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": email.idempotencyKey,
      },
      body: JSON.stringify({
        from: config.from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new RetryableError("email_unavailable", "O Resend não respondeu.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const body = (await response.json().catch(() => ({}))) as { id?: string; name?: string; message?: string };
  if (response.ok && typeof body.id === "string") return body.id;

  const details = { httpStatus: response.status, resendError: body.name };
  if (response.status === 429 || response.status >= 500) {
    throw new RetryableError("email_unavailable", "O Resend está indisponível no momento.", details);
  }
  if (response.status === 401) {
    throw new PermanentError("email_misconfigured", "Chave do Resend inválida.", details);
  }
  // 403/422: destinatário não permitido (domínio não verificado), endereço
  // inválido, remetente recusado — tentar de novo não muda nada.
  throw new PermanentError("email_rejected", body.message ?? "O Resend recusou o e-mail.", details);
}
