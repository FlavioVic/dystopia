/**
 * Serviço de aparelhos conhecidos — o navegador onde a pessoa já entrou.
 *
 * Existe por causa do limite de login por conta: com ele, quem sabe o e-mail
 * de alguém poderia errar a senha de propósito e trancar a conta. Aqui está o
 * remédio da OWASP ("device cookies"): o navegador onde o dono já entrou com
 * sucesso ganha um cookie, e nele o login conta tentativas à parte. O ataque
 * tranca só os aparelhos desconhecidos; o dono continua entrando do dele.
 *
 * O cookie não autentica nada — a senha (e o código do autenticador) continua
 * sendo exigida. Ele só escolhe qual contador do limite vale. Mesmo desenho das
 * sessões: o cookie leva 32 bytes aleatórios e o banco guarda o SHA-256.
 */

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Executor } from "@/db";
import { knownDevices } from "@/db/schema";

/** Sem uso por esse tempo, o aparelho volta a ser desconhecido. */
export const KNOWN_DEVICE_TTL_SECONDS = 60 * 60 * 24 * 180;

function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function staleBefore(now: Date): Date {
  return new Date(now.getTime() - KNOWN_DEVICE_TTL_SECONDS * 1000);
}

export type KnownDevice = { id: string; userId: string };

/** Aparelho do token, se existe e foi usado nos últimos 180 dias. */
export async function findKnownDevice(executor: Executor, token: string, now = new Date()): Promise<KnownDevice | null> {
  const [device] = await executor
    .select({ id: knownDevices.id, userId: knownDevices.userId })
    .from(knownDevices)
    .where(and(eq(knownDevices.id, hashDeviceToken(token)), gt(knownDevices.lastUsedAt, staleBefore(now))));
  return device ?? null;
}

/**
 * Login completo neste navegador. Se o cookie atual já é um aparelho desta
 * conta, renova o uso e mantém o token; senão, cria um aparelho novo (o
 * cookie de outra conta é substituído — um navegador, uma conta lembrada).
 */
export async function rememberDevice(
  executor: Executor,
  input: { userId: string; currentToken?: string },
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(now.getTime() + KNOWN_DEVICE_TTL_SECONDS * 1000);

  if (input.currentToken) {
    const [renewed] = await executor
      .update(knownDevices)
      .set({ lastUsedAt: now })
      .where(and(eq(knownDevices.id, hashDeviceToken(input.currentToken)), eq(knownDevices.userId, input.userId)))
      .returning({ id: knownDevices.id });
    if (renewed) return { token: input.currentToken, expiresAt };
  }

  const token = randomBytes(32).toString("base64url");
  await executor.insert(knownDevices).values({ id: hashDeviceToken(token), userId: input.userId, createdAt: now, lastUsedAt: now });
  return { token, expiresAt };
}

/** Faxina do worker/cron: aparelho sem uso há 180 dias não vale mais. */
export async function pruneStaleDevices(executor: Executor, now = new Date()): Promise<number> {
  const removed = await executor
    .delete(knownDevices)
    .where(lt(knownDevices.lastUsedAt, staleBefore(now)))
    .returning({ id: knownDevices.id });
  return removed.length;
}
