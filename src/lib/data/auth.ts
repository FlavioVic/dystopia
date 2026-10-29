import { cache } from "react";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { mfaCredentials, sessions, users } from "@/db/schema";
import { readSessionToken } from "@/lib/session";
import { hashSessionToken } from "@/services/sessions";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: "customer" | "admin";
  /** Autenticador confirmado. Sem ele, admin não entra no painel. */
  mfaEnabled: boolean;
};

/**
 * A sessão de um token, conferida no banco: existe, não venceu, e de quem é.
 * Uma query só (sessão + usuário + MFA). Recebe o executor para os testes
 * provarem a regra sem cookie.
 */
export async function lookupSession(executor: Executor, token: string) {
  const [row] = await executor
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      mfaPending: sessions.mfaPending,
      mfaConfirmedAt: mfaCredentials.confirmedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(mfaCredentials, eq(mfaCredentials.userId, sessions.userId))
    .where(and(eq(sessions.id, hashSessionToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

export type SessionLookup = NonNullable<Awaited<ReturnType<typeof lookupSession>>>;

/** Sessão que ainda espera o código do autenticador não é login. */
export function currentUserFrom(row: SessionLookup | null): CurrentUser | null {
  if (!row || row.mfaPending) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role, mfaEnabled: row.mfaConfirmedAt !== null };
}

/** A sessão do cookie, memoizada por request (layout e páginas chamam sem duplicar a query). */
const readSession = cache(async () => {
  const token = await readSessionToken();
  return token ? lookupSession(db, token) : null;
});

/** Usuário logado ou null. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => currentUserFrom(await readSession()));

/** Quem já passou da senha e falta o código (tela `/entrar/verificacao`). */
export const getPendingMfaUser = cache(async (): Promise<{ id: string; email: string } | null> => {
  const row = await readSession();
  if (!row?.mfaPending || !row.mfaConfirmedAt) return null;
  return { id: row.id, email: row.email };
});

/** Admin de verdade: papel admin E segundo fator. Senha sozinha não abre o painel. */
export function isAdmin(user: CurrentUser | null): user is CurrentUser {
  return user?.role === "admin" && user.mfaEnabled;
}

/**
 * Exige admin. Sem login (ou cliente) → /entrar; admin ainda sem
 * autenticador → cadastra primeiro, em /conta/seguranca.
 */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") redirect("/entrar");
  if (!user.mfaEnabled) redirect("/conta/seguranca");
  return user;
}
