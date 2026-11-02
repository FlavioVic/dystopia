/**
 * Serviço de redefinição de senha — os links de "esqueci minha senha".
 *
 * O link leva 32 bytes aleatórios; o banco guarda só o SHA-256 deles (o mesmo
 * desenho da sessão). Quem lê o banco não consegue montar um link válido.
 *
 * - vale 30 minutos;
 * - uso único: usar é um DELETE ... RETURNING, então dois envios simultâneos
 *   do mesmo link não trocam a senha duas vezes;
 * - um por conta: pedir de novo apaga o anterior (só o e-mail mais recente vale).
 */

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Executor } from "@/db";
import { passwordResets } from "@/db/schema";

export const PASSWORD_RESET_TTL_SECONDS = 30 * 60;

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Cria o link da conta (e invalida o anterior). Devolve o token, que só existe no e-mail. */
export async function createPasswordReset(
  executor: Executor,
  userId: string,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_SECONDS * 1000);
  await executor.delete(passwordResets).where(eq(passwordResets.userId, userId));
  await executor.insert(passwordResets).values({ id: hashResetToken(token), userId, createdAt: now, expiresAt });
  return { token, expiresAt };
}

/** Dono do link, se ele ainda vale (sem gastar). */
export async function findPasswordReset(executor: Executor, token: string, now = new Date()): Promise<{ userId: string } | null> {
  const [row] = await executor
    .select({ userId: passwordResets.userId })
    .from(passwordResets)
    .where(and(eq(passwordResets.id, hashResetToken(token)), gt(passwordResets.expiresAt, now)));
  return row ?? null;
}

/** Gasta o link: devolve o dono uma vez só; depois (ou vencido), `null`. */
export async function consumePasswordReset(executor: Executor, token: string, now = new Date()): Promise<{ userId: string } | null> {
  const [row] = await executor
    .delete(passwordResets)
    .where(and(eq(passwordResets.id, hashResetToken(token)), gt(passwordResets.expiresAt, now)))
    .returning({ userId: passwordResets.userId });
  return row ?? null;
}

/** Senha trocada: nenhum outro link da conta vale mais. */
export async function revokePasswordResets(executor: Executor, userId: string): Promise<void> {
  await executor.delete(passwordResets).where(eq(passwordResets.userId, userId));
}

/** Faxina do worker/cron: link vencido não serve para nada. */
export async function pruneExpiredPasswordResets(executor: Executor, now = new Date()): Promise<number> {
  const removed = await executor
    .delete(passwordResets)
    .where(lt(passwordResets.expiresAt, now))
    .returning({ id: passwordResets.id });
  return removed.length;
}
