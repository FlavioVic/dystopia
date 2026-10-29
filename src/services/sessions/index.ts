/**
 * Serviço de sessões — login guardado no banco, não num JWT.
 *
 * Com JWT, sair só apagava o cookie: quem tivesse copiado o token continuava
 * logado até ele expirar (7 dias). Aqui a sessão é uma linha; sair apaga a
 * linha e o token deixa de valer na hora, em qualquer lugar.
 *
 * O cookie leva 32 bytes aleatórios; o banco guarda o SHA-256 deles. Hash
 * rápido basta (o token não é senha: 256 bits de acaso não se adivinham), e
 * quem lê o banco não tem o que colar num cookie.
 *
 * Sessão `mfaPending` é a metade do caminho de quem tem segundo fator: senha
 * conferida, código ainda não. Dura minutos e não vale como login.
 */

import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, gt, lt, ne } from "drizzle-orm";
import type { Executor } from "@/db";
import { sessions } from "@/db/schema";

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 dias, sem renovação
export const PENDING_MFA_TTL_SECONDS = 60 * 10;

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Abre a sessão e devolve o token (que só existe no cookie). Aproveita para
 * apagar as sessões vencidas da pessoa — a tabela não cresce sem o cron.
 */
export async function createSession(
  executor: Executor,
  input: { userId: string; mfaPending: boolean },
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const ttl = input.mfaPending ? PENDING_MFA_TTL_SECONDS : SESSION_TTL_SECONDS;
  const expiresAt = new Date(now.getTime() + ttl * 1000);

  await executor.delete(sessions).where(and(eq(sessions.userId, input.userId), lt(sessions.expiresAt, now)));
  await executor.insert(sessions).values({
    id: hashSessionToken(token),
    userId: input.userId,
    mfaPending: input.mfaPending,
    createdAt: now,
    expiresAt,
  });
  return { token, expiresAt };
}

/**
 * Código conferido: a sessão pendente vira login de verdade (e ganha a
 * validade cheia). `null` se ela não existe mais ou já não estava pendente
 * (quem chama já conferiu a validade ao ler a sessão).
 */
export async function completeMfa(
  executor: Executor,
  token: string,
  now = new Date(),
): Promise<{ expiresAt: Date } | null> {
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  const [updated] = await executor
    .update(sessions)
    .set({ mfaPending: false, expiresAt })
    .where(and(eq(sessions.id, hashSessionToken(token)), eq(sessions.mfaPending, true)))
    .returning({ expiresAt: sessions.expiresAt });
  return updated ?? null;
}

/** Sair: a sessão deste token deixa de existir. */
export async function revokeSession(executor: Executor, token: string): Promise<void> {
  await executor.delete(sessions).where(eq(sessions.id, hashSessionToken(token)));
}

/** "Sair dos outros aparelhos": tudo da pessoa menos a sessão atual. */
export async function revokeOtherSessions(executor: Executor, userId: string, keepToken: string): Promise<number> {
  const removed = await executor
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.id, hashSessionToken(keepToken))))
    .returning({ id: sessions.id });
  return removed.length;
}

/** Sessões que ainda valem (contando a atual). Pendente de MFA não conta. */
export async function countActiveSessions(executor: Executor, userId: string, now = new Date()): Promise<number> {
  const [row] = await executor
    .select({ value: count() })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.mfaPending, false), gt(sessions.expiresAt, now)));
  return row?.value ?? 0;
}

/** Faxina do worker/cron: sessão vencida não serve para nada. */
export async function pruneExpiredSessions(executor: Executor, now = new Date()): Promise<number> {
  const removed = await executor.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ id: sessions.id });
  return removed.length;
}
