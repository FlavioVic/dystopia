import { cookies } from "next/headers";
import { db } from "@/db";
import * as sessionsService from "@/services/sessions";

/**
 * Cookie da sessão. O cookie leva só o token aleatório; quem a pessoa é, se
 * é admin e se a sessão ainda vale, quem diz é a tabela `sessions` (ver
 * `services/sessions`). Escrever cookie só funciona em Server Action e Route
 * Handler — por isso abrir e fechar sessão moram aqui, e ler mora em
 * `lib/data/auth.ts`.
 */

export const SESSION_COOKIE = "session";

/** Token do cookie atual (sem conferir no banco). */
export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

async function writeCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Abre a sessão (pendente de MFA ou completa) e grava o cookie. */
export async function startSession(input: { userId: string; mfaPending: boolean }): Promise<void> {
  const { token, expiresAt } = await sessionsService.createSession(db, input);
  await writeCookie(token, expiresAt);
}

/** Código do autenticador conferido: a sessão pendente vira login. */
export async function completeMfaSession(): Promise<boolean> {
  const token = await readSessionToken();
  if (!token) return false;
  const completed = await sessionsService.completeMfa(db, token);
  if (!completed) return false;
  await writeCookie(token, completed.expiresAt);
  return true;
}

/** Sair: apaga a sessão no banco (o token deixa de valer em qualquer lugar) e o cookie. */
export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await sessionsService.revokeSession(db, token);
  store.delete(SESSION_COOKIE);
}
