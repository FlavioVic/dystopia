"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { completeMfaSession, endSession, startSession } from "@/lib/session";
import { CART_COOKIE } from "@/lib/data/cart";
import { getPendingMfaUser } from "@/lib/data/auth";
import { limitAction, retryMessage } from "@/lib/action-limits";
import { limitFromEnv } from "@/lib/rate-limit-config";
import { getRequestIp } from "@/lib/request-ip";
import { parseLoginForm, parseSignupForm } from "@/lib/validation/account";
import { PermanentError } from "@/shared/errors";
import { registerAccount, verifyCredentials, type Account } from "@/services/accounts";
import { claimGuestCart } from "@/services/carts";
import { hasConfirmedMfa, verifySecondFactor } from "@/services/mfa";
import { consumeRateLimit, type RateLimitRule } from "@/services/rate-limit";

export type AuthState = {
  errors?: { name?: string; email?: string; password?: string };
  message?: string;
  values?: { name?: string; email?: string };
} | undefined;

// Por IP, não por e-mail: limite por e-mail deixaria qualquer um trancar a
// conta demo (cujo e-mail é público) errando a senha de propósito. O número
// muda por variável só para a stack de teste (vários cadastros do mesmo IP); o
// padrão é o de produção.
const LOGIN_RULE: RateLimitRule = { limit: limitFromEnv("LOGIN_LIMIT_PER_15MIN", 10), windowSeconds: 15 * 60 };
const SIGNUP_RULE: RateLimitRule = { limit: limitFromEnv("SIGNUP_LIMIT_PER_HOUR", 5), windowSeconds: 60 * 60 };

async function rateLimited(action: string, rule: RateLimitRule): Promise<string | null> {
  const { allowed, retryAfterSeconds } = await consumeRateLimit(db, `${action}:ip:${await getRequestIp()}`, rule);
  return allowed ? null : retryMessage(retryAfterSeconds);
}

/**
 * Senha conferida. Com autenticador cadastrado, a sessão nasce pendente e a
 * pessoa vai digitar o código; sem, já é login (admin sem autenticador entra
 * como cliente e é mandado cadastrar um — o painel exige).
 */
async function signIn(account: Account): Promise<never> {
  const mfa = await hasConfirmedMfa(db, account.id);
  await startSession({ userId: account.id, mfaPending: mfa });
  if (mfa) redirect("/entrar/verificacao");
  await claimCart(account.id);
  redirect(account.role === "admin" ? "/conta/seguranca" : "/conta");
}

/** Leva junto o carrinho de visitante, se houver. */
async function claimCart(userId: string): Promise<void> {
  const token = (await cookies()).get(CART_COOKIE)?.value;
  if (token) await claimGuestCart(db, token, userId);
}

export async function signup(_prev: AuthState, formData: FormData): Promise<AuthState> {
  // O que a pessoa digitou volta para o formulário (a senha nunca).
  const echo = { name: String(formData.get("name") ?? ""), email: String(formData.get("email") ?? "") };
  const parsed = parseSignupForm(formData);
  if (!parsed.ok) return { errors: parsed.errors, values: echo };
  const { values } = parsed;

  const limited = await rateLimited("signup", SIGNUP_RULE);
  if (limited) return { message: limited, values: echo };

  let account: Account;
  try {
    account = await registerAccount(db, values);
  } catch (error) {
    if (error instanceof PermanentError && error.code === "email_taken") {
      return { errors: { email: error.message }, values: echo };
    }
    throw error;
  }
  return signIn(account);
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const echo = { email: String(formData.get("email") ?? "") };
  const parsed = parseLoginForm(formData);
  if (!parsed.ok) return { message: "E-mail ou senha inválidos.", values: echo };
  const { email, password } = parsed.values;

  const limited = await rateLimited("login", LOGIN_RULE);
  if (limited) return { message: limited, values: echo };

  const account = await verifyCredentials(db, { email, password });
  if (!account) return { message: "E-mail ou senha inválidos.", values: echo };
  return signIn(account);
}

export type MfaLoginState = { message?: string } | undefined;

/** Segunda etapa do login: código do autenticador ou de recuperação. */
export async function verifyLoginCode(_prev: MfaLoginState, formData: FormData): Promise<MfaLoginState> {
  const pending = await getPendingMfaUser();
  if (!pending) redirect("/entrar");

  // Por conta, não por IP: quem tem a senha troca de IP à vontade. 6 dígitos
  // são 1 milhão de chances; com o limite, chutar leva anos.
  const limited = (await limitAction("mfa", `user:${pending.id}`)) ?? (await limitAction("mfaDaily", `user:${pending.id}`));
  if (limited) return { message: limited };

  const result = await verifySecondFactor(db, pending.id, String(formData.get("code") ?? ""));
  if (!result) return { message: "Código inválido ou já usado." };
  if (!(await completeMfaSession())) redirect("/entrar");

  await claimCart(pending.id);
  redirect(result.method === "recovery" ? "/conta/seguranca?recuperacao=1" : "/admin");
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/entrar");
}
