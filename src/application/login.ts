/**
 * Caso de uso: entrar com e-mail e senha — e o limite de tentativas dele.
 *
 * Dois limites, porque cada um sozinho deixa um buraco:
 * - por IP (de sempre): segura quem tenta muitas senhas de um lugar só, em
 *   qualquer conta. Não segura um ataque distribuído (cada IP tenta poucas
 *   vezes a mesma conta);
 * - por conta: segura o ataque distribuído. O risco dele é o oposto — quem
 *   sabe o e-mail de alguém erra a senha de propósito e tranca a conta. O
 *   remédio é o da OWASP ("device cookies"): no navegador onde o dono já
 *   entrou (`services/known-devices`), as falhas contam num contador do
 *   aparelho, e o ataque não chega nele. Quem fica trancado é só o aparelho
 *   desconhecido.
 *
 * O contador da conta conta falhas: cada tentativa reserva uma vaga antes de
 * conferir a senha, e o login certo devolve a dele. E-mail que não tem conta
 * conta igual — a resposta não pode revelar quais e-mails existem.
 *
 * A conta demo fica fora do limite por conta: a senha dela está publicada em
 * /sobre, não há o que proteger, e trancá-la só atrapalharia quem visita.
 */

import { createHash } from "node:crypto";
import { db } from "@/db";
import { limitFromEnv } from "@/lib/rate-limit-config";
import { DEMO_ACCOUNT_EMAIL } from "@/lib/site";
import { findAccountIdByEmail, verifyCredentials, type Account } from "@/services/accounts";
import { findKnownDevice } from "@/services/known-devices";
import { consumeRateLimit, refundRateLimits, type RateLimitRule } from "@/services/rate-limit";

export const LOGIN_LIMITS = {
  // O número muda por variável só na stack de teste (vários logins do mesmo IP).
  ip: { limit: limitFromEnv("LOGIN_LIMIT_PER_15MIN", 10), windowSeconds: 15 * 60 },
  // Aparelho desconhecido. A janela curta segura a rajada; a diária é a que
  // faz um ataque distribuído levar anos (50 senhas por dia, por conta).
  account: { limit: 10, windowSeconds: 15 * 60 },
  accountDaily: { limit: 50, windowSeconds: 24 * 60 * 60 },
  // Aparelho onde o dono já entrou: só a rajada (é ele errando a própria senha).
  device: { limit: 10, windowSeconds: 15 * 60 },
} satisfies Record<string, RateLimitRule>;

export type LoginResult =
  | { status: "ok"; account: Account }
  | { status: "invalid" }
  /** `scope: "account"` = o e-mail está trancado neste aparelho (noutro conhecido, não). */
  | { status: "limited"; scope: "ip" | "account"; retryAfterSeconds: number };

type Counter = { key: string; rule: RateLimitRule };

/** O e-mail entra na chave como hash: a tabela de limites não guarda e-mail digitado. */
function emailKey(email: string): string {
  return createHash("sha256").update(email).digest("hex").slice(0, 32);
}

/** Qual contador de conta vale para esta tentativa (nenhum, para a conta demo). */
async function accountCounters(email: string, deviceToken: string | undefined): Promise<Counter[]> {
  if (email === DEMO_ACCOUNT_EMAIL) return [];

  const device = deviceToken ? await findKnownDevice(db, deviceToken) : null;
  if (device && device.userId === (await findAccountIdByEmail(db, email))) {
    return [{ key: `login:device:${device.id}`, rule: LOGIN_LIMITS.device }];
  }
  const hashed = emailKey(email);
  return [
    { key: `login:account:${hashed}`, rule: LOGIN_LIMITS.account },
    { key: `login:account-day:${hashed}`, rule: LOGIN_LIMITS.accountDaily },
  ];
}

export async function attemptLogin(input: {
  email: string;
  password: string;
  ip: string;
  /** Cookie `known_device` deste navegador, se houver. */
  deviceToken?: string;
}): Promise<LoginResult> {
  const byIp = await consumeRateLimit(db, `login:ip:${input.ip}`, LOGIN_LIMITS.ip);
  if (!byIp.allowed) return { status: "limited", scope: "ip", retryAfterSeconds: byIp.retryAfterSeconds };

  const counters = await accountCounters(input.email, input.deviceToken);
  const reserved: string[] = [];
  for (const { key, rule } of counters) {
    const result = await consumeRateLimit(db, key, rule);
    reserved.push(key);
    if (!result.allowed) return { status: "limited", scope: "account", retryAfterSeconds: result.retryAfterSeconds };
  }

  const account = await verifyCredentials(db, { email: input.email, password: input.password });
  if (!account) return { status: "invalid" };

  await refundRateLimits(db, reserved);
  return { status: "ok", account };
}
