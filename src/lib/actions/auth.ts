"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { createSession, deleteSession } from "@/lib/session";
import { CART_COOKIE } from "@/lib/data/cart";
import { getRequestIp } from "@/lib/request-ip";
import { parseLoginForm, parseSignupForm } from "@/lib/validation/account";
import { PermanentError } from "@/saga/errors";
import { registerAccount, verifyCredentials, type Account } from "@/services/accounts";
import { claimGuestCart } from "@/services/carts";
import { consumeRateLimit, type RateLimitRule } from "@/services/rate-limit";

export type AuthState = {
  errors?: { name?: string; email?: string; password?: string };
  message?: string;
  values?: { name?: string; email?: string };
} | undefined;

// Por IP, não por e-mail: limite por e-mail deixaria qualquer um trancar a
// conta demo (cujo e-mail é público) errando a senha de propósito. O número
// muda por variável só pra stack de teste (vários cadastros do mesmo IP); o
// padrão é o de produção.
const LOGIN_RULE: RateLimitRule = { limit: limitFromEnv("LOGIN_LIMIT_PER_15MIN", 10), windowSeconds: 15 * 60 };
const SIGNUP_RULE: RateLimitRule = { limit: limitFromEnv("SIGNUP_LIMIT_PER_HOUR", 5), windowSeconds: 60 * 60 };

function limitFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

async function rateLimited(action: string, rule: RateLimitRule): Promise<string | null> {
  const { allowed, retryAfterSeconds } = await consumeRateLimit(db, `${action}:ip:${await getRequestIp()}`, rule);
  if (allowed) return null;
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return `Muitas tentativas. Tente de novo em ${minutes} ${minutes === 1 ? "minuto" : "minutos"}.`;
}

/** Abre a sessão e leva junto o carrinho de visitante, se houver. */
async function signIn(account: Account): Promise<never> {
  await createSession({ userId: account.id, role: account.role });
  const token = (await cookies()).get(CART_COOKIE)?.value;
  if (token) await claimGuestCart(db, token, account.id);
  redirect("/conta");
}

export async function signup(_prev: AuthState, formData: FormData): Promise<AuthState> {
  // O que a pessoa digitou volta pro formulário (a senha nunca).
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

export async function logout(): Promise<void> {
  await deleteSession();
  redirect("/entrar");
}
