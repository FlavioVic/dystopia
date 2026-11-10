/**
 * Caso de uso: "esqueci minha senha", no desenho da OWASP (Forgot Password
 * Cheat Sheet).
 *
 * - A resposta não diz se a conta existe: a tela mostra a mesma mensagem, e
 *   procurar a conta e mandar o e-mail acontece DEPOIS da resposta
 *   (`composition/web.ts`), então nem o tempo de resposta entrega.
 * - O link é uma credencial: o banco guarda só o hash, ele vale 30 minutos e
 *   uma vez só, e o e-mail sai sem ser gravado (`notifications/direct.ts`).
 * - Trocar a senha derruba todos os logins abertos (quem tinha a senha antiga
 *   sai) e invalida qualquer outro link. Não faz login sozinho: a pessoa entra
 *   pelo caminho normal, com o código do autenticador se tiver.
 * - Limites: por IP (antes da resposta) e por e-mail (depois, em silêncio —
 *   segura quem quer lotar a caixa de alguém de e-mails).
 * - A conta demo não troca de senha: ela está publicada em /sobre.
 */

import { createHash } from "node:crypto";
import { db } from "@/db";
import { limitFromEnv } from "@/lib/rate-limit-config";
import { DEMO_ACCOUNT_EMAIL, SITE_URL } from "@/lib/site";
import { findAccountByEmail, setPassword } from "@/services/accounts";
import { sendEmailNow, type DirectEmail } from "@/services/notifications/direct";
import { passwordResetEmail } from "@/services/notifications/templates";
import {
  consumePasswordReset,
  createPasswordReset,
  findPasswordReset,
  PASSWORD_RESET_TTL_SECONDS,
  revokePasswordResets,
} from "@/services/password-resets";
import { consumeRateLimit, type RateLimitResult, type RateLimitRule } from "@/services/rate-limit";
import { revokeAllSessions } from "@/services/sessions";

export const PASSWORD_RESET_LIMITS = {
  // O número muda por variável só na stack de teste (vários pedidos do mesmo IP).
  ip: { limit: limitFromEnv("PASSWORD_RESET_LIMIT_PER_HOUR", 5), windowSeconds: 60 * 60 },
  email: { limit: 3, windowSeconds: 60 * 60 },
  // Troca da senha pelo link (`resetPasswordWithLink`): a borda pública que
  // GASTA o token. O link tem 256 bits de acaso (adivinhar é inviável), mas
  // sem limite aqui a rota viraria um oráculo de "este token vale?" sem teto —
  // OWASP pede anti-automação em todo passo de recuperação. Um pouco acima do
  // pedido: quem erra a senha nova (vazada, não confere) tenta de novo no mesmo link.
  submit: { limit: limitFromEnv("PASSWORD_RESET_SUBMIT_LIMIT_PER_HOUR", 10), windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Antes da resposta: só o limite por IP, que não depende de a conta existir. */
export function limitPasswordResetRequests(ip: string): Promise<RateLimitResult> {
  return consumeRateLimit(db, `password-reset:ip:${ip}`, PASSWORD_RESET_LIMITS.ip);
}

/**
 * Limite por IP da TROCA pelo link (chave à parte do pedido: um não gasta a
 * cota do outro). Segura a varredura de tokens antes de qualquer consulta ao
 * banco ou ao Pwned Passwords.
 */
export function limitPasswordResetAttempts(ip: string): Promise<RateLimitResult> {
  return consumeRateLimit(db, `password-reset-attempt:ip:${ip}`, PASSWORD_RESET_LIMITS.submit);
}

export type PasswordResetDeps = {
  send?: (email: DirectEmail) => Promise<unknown>;
  siteUrl?: string;
};

/**
 * Depois da resposta: se o e-mail tem conta, cria o link e manda. Devolve o
 * que fez só para log e teste — nunca para a pessoa.
 */
export async function sendPasswordResetLink(
  email: string,
  deps: PasswordResetDeps = {},
): Promise<"sent" | "no-account" | "demo" | "limited"> {
  if (email === DEMO_ACCOUNT_EMAIL) return "demo";

  const perEmail = await consumeRateLimit(
    db,
    `password-reset:email:${sha256(email).slice(0, 32)}`,
    PASSWORD_RESET_LIMITS.email,
  );
  if (!perEmail.allowed) return "limited";

  const account = await findAccountByEmail(db, email);
  if (!account) return "no-account";

  const siteUrl = deps.siteUrl ?? SITE_URL;
  const { token } = await createPasswordReset(db, account.id);
  const link = `${siteUrl}/entrar/redefinir?token=${encodeURIComponent(token)}`;
  const content = passwordResetEmail({ name: account.name, link, minutes: PASSWORD_RESET_TTL_SECONDS / 60 }, siteUrl);

  const send = deps.send ?? ((message: DirectEmail) => sendEmailNow(message));
  // A chave de idempotência do provedor não pode ser o token (ela fica nos logs dele).
  await send({ to: email, ...content, idempotencyKey: `password-reset:${sha256(token).slice(0, 32)}` });
  return "sent";
}

/** A página do link: ele ainda vale? (Só confere; quem gasta é `resetPassword`.) */
export async function isPasswordResetLinkValid(token: string): Promise<boolean> {
  return (await findPasswordReset(db, token)) !== null;
}

/**
 * Troca a senha pelo link. `null` se o link não vale (usado, vencido,
 * inventado). Tudo numa transação: gastar o link, trocar a senha e derrubar
 * os logins acontecem juntos ou não acontecem.
 */
export async function resetPassword(input: { token: string; password: string }): Promise<{ userId: string } | null> {
  return db.transaction(async (tx) => {
    const reset = await consumePasswordReset(tx, input.token);
    if (!reset) return null;
    await setPassword(tx, reset.userId, input.password);
    await revokeAllSessions(tx, reset.userId);
    await revokePasswordResets(tx, reset.userId);
    return reset;
  });
}
