"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { carts, users } from "@/db/schema";
import { createSession, deleteSession } from "@/lib/session";
import { CART_COOKIE } from "@/lib/data/cart";

export type AuthState = {
  errors?: { name?: string; email?: string; password?: string };
  message?: string;
  values?: { name?: string; email?: string };
} | undefined;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true, role: true, passwordHash: true },
  });

  // Compara sempre (mesmo sem usuário) pra não vazar quais e-mails existem.
  const hash = user?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidin";
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
