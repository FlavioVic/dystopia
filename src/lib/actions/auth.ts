"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { carts, users } from "@/db/schema";
import { createSession, deleteSession } from "@/lib/session";
import { CART_COOKIE } from "@/lib/data/cart";
import { getRequestIp } from "@/lib/request-ip";
import { consumeRateLimit, type RateLimitRule } from "@/services/rate-limit";

export type AuthState = {
  errors?: { name?: string; email?: string; password?: string };
  message?: string;
  values?: { name?: string; email?: string };
} | undefined;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Por IP, não por e-mail: limite por e-mail deixaria qualquer um trancar a
// conta demo (cujo e-mail é público) errando a senha de propósito.
const LOGIN_RULE: RateLimitRule = { limit: 10, windowSeconds: 15 * 60 };
const SIGNUP_RULE: RateLimitRule = { limit: 5, windowSeconds: 60 * 60 };

// Hash bcrypt válido (custo 10, de um segredo aleatório descartado) pra
// comparar quando o e-mail não existe. Precisa ser um hash real: um inválido
// é recusado na hora, e a resposta mais rápida entregaria quais e-mails têm conta.
const DUMMY_HASH = "$2b$10$Y/CEvd/r/IxO4k29XllMJOjmYQnSj8TaybVNu9sGSAoHuQnkbS5A.";

async function rateLimited(action: string, rule: RateLimitRule): Promise<string | null> {
  const { allowed, retryAfterSeconds } = await consumeRateLimit(db, `${action}:ip:${await getRequestIp()}`, rule);
  if (allowed) return null;
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return `Muitas tentativas. Tente de novo em ${minutes} ${minutes === 1 ? "minuto" : "minutos"}.`;
}

/** Ao autenticar, vincula o carrinho de visitante (se houver) ao usuário. */
async function attachGuestCartToUser(userId: string) {
  const token = (await cookies()).get(CART_COOKIE)?.value;
  if (!token) return;
  await db.update(carts).set({ userId }).where(eq(carts.sessionToken, token));
}

export async function signup(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const errors: NonNullable<AuthState>["errors"] = {};
  if (name.length < 2) errors.name = "Informe seu nome (mín. 2 caracteres).";
  if (!EMAIL_RE.test(email)) errors.email = "Informe um e-mail válido.";
  if (password.length < 8) errors.password = "A senha precisa ter ao menos 8 caracteres.";
  if (Object.keys(errors).length > 0) return { errors, values: { name, email } };

  const limited = await rateLimited("signup", SIGNUP_RULE);
  if (limited) return { message: limited, values: { name, email } };

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true },
  });
  if (existing) {
    return { errors: { email: "Já existe uma conta com esse e-mail." }, values: { name, email } };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db
    .insert(users)
    .values({ name, email, passwordHash })
    .returning({ id: users.id, role: users.role });

  if (!user) return { message: "Não foi possível criar a conta. Tente de novo.", values: { name, email } };

  await createSession({ userId: user.id, role: user.role });
  await attachGuestCartToUser(user.id);
  redirect("/conta");
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!EMAIL_RE.test(email) || password.length === 0) {
    return { message: "E-mail ou senha inválidos.", values: { email } };
  }

  const limited = await rateLimited("login", LOGIN_RULE);
  if (limited) return { message: limited, values: { email } };

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true, role: true, passwordHash: true },
  });

  // Compara sempre (mesmo sem usuário) pra não vazar quais e-mails existem.
  const hash = user?.passwordHash ?? DUMMY_HASH;
  const ok = await bcrypt.compare(password, hash);
  if (!user || !ok) {
    return { message: "E-mail ou senha inválidos.", values: { email } };
  }

  await createSession({ userId: user.id, role: user.role });
  await attachGuestCartToUser(user.id);
  redirect("/conta");
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect("/entrar");
}
