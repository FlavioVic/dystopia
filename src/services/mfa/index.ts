/**
 * Serviço de MFA — segundo fator por app autenticador (TOTP), obrigatório
 * para admin. Senha vazada sozinha não abre o painel.
 *
 * Regras que moram aqui:
 * - o segredo fica cifrado no banco (`secret-box.ts`) e só aparece em claro
 *   uma vez, no QR do cadastro;
 * - cadastro só vale depois do primeiro código certo (QR escaneado errado não
 *   tranca ninguém para fora);
 * - código usado não entra de novo: o passo de 30 s aceito fica gravado, e o
 *   UPDATE só passa para um passo maior — dois logins com o mesmo código ao
 *   mesmo tempo, só um entra;
 * - códigos de recuperação (celular perdido) valem uma vez cada e ficam só
 *   como hash.
 */

import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { mfaCredentials, mfaRecoveryCodes } from "@/db/schema";
import { PermanentError } from "@/shared/errors";
import { openSecret, sealSecret } from "./secret-box";
import { base32Encode, generateTotpSecret, matchTotp } from "./totp";

export const RECOVERY_CODE_COUNT = 10;

export type MfaStatus =
  | { enabled: false }
  | { enabled: true; confirmedAt: Date; recoveryCodesLeft: number };

export async function getMfaStatus(executor: Executor, userId: string): Promise<MfaStatus> {
  const credential = await executor.query.mfaCredentials.findFirst({
    where: and(eq(mfaCredentials.userId, userId), isNotNull(mfaCredentials.confirmedAt)),
    columns: { confirmedAt: true },
  });
  if (!credential?.confirmedAt) return { enabled: false };
  return { enabled: true, confirmedAt: credential.confirmedAt, recoveryCodesLeft: await countRecoveryCodes(executor, userId) };
}

export async function hasConfirmedMfa(executor: Executor, userId: string): Promise<boolean> {
  return (await getMfaStatus(executor, userId)).enabled;
}

/**
 * Começa (ou recomeça) o cadastro: segredo novo, ainda não confirmado.
 * Devolve o segredo em claro para virar QR — a única vez que ele sai daqui.
 * Já confirmado → `PermanentError("mfa_already_enabled")`.
 */
export async function beginEnrollment(executor: Executor, userId: string): Promise<Buffer> {
  const secret = generateTotpSecret();
  const [row] = await executor
    .insert(mfaCredentials)
    .values({ userId, secret: sealSecret(secret, userId) })
    .onConflictDoUpdate({
      target: mfaCredentials.userId,
      set: { secret: sql`excluded.secret`, lastUsedStep: null, createdAt: sql`now()` },
      setWhere: isNull(mfaCredentials.confirmedAt),
    })
    .returning({ userId: mfaCredentials.userId });
  if (!row) throw new PermanentError("mfa_already_enabled", "O autenticador já está cadastrado.");
  return secret;
}

/**
 * Primeiro código certo confirma o cadastro e gera os códigos de recuperação
 * (devolvidos em claro só agora). Código errado → `null`.
 */
export async function confirmEnrollment(
  executor: Executor,
  userId: string,
  code: string,
  now = new Date(),
): Promise<string[] | null> {
  const pending = await executor.query.mfaCredentials.findFirst({
    where: and(eq(mfaCredentials.userId, userId), isNull(mfaCredentials.confirmedAt)),
    columns: { secret: true },
  });
  if (!pending) throw new PermanentError("mfa_not_started", "Gere o QR code de novo.");

  const step = matchTotp(openSecret(pending.secret, userId), code.replace(/\s/g, ""), now);
  if (step === null) return null;

  return executor.transaction(async (tx) => {
    // O segredo na condição: se outra aba gerou QR novo no meio, este código
    // era do segredo antigo e não pode confirmar o novo.
    const [confirmed] = await tx
      .update(mfaCredentials)
      .set({ confirmedAt: now, lastUsedStep: step })
      .where(and(
        eq(mfaCredentials.userId, userId),
        isNull(mfaCredentials.confirmedAt),
        eq(mfaCredentials.secret, pending.secret),
      ))
      .returning({ userId: mfaCredentials.userId });
    if (!confirmed) throw new PermanentError("mfa_enrollment_changed", "O QR code mudou no meio (outra aba?). Gere de novo.");
    return replaceRecoveryCodes(tx, userId, now);
  });
}

export type SecondFactorResult = { method: "totp" } | { method: "recovery"; recoveryCodesLeft: number };

/**
 * Segundo fator do login: 6 dígitos do autenticador ou um código de
 * recuperação. `null` se não bate, já foi usado ou não há MFA confirmado.
 */
export async function verifySecondFactor(
  executor: Executor,
  userId: string,
  input: string,
  now = new Date(),
): Promise<SecondFactorResult | null> {
  const compact = input.replace(/\s/g, "");
  if (/^\d{6}$/.test(compact)) {
    return (await consumeTotp(executor, userId, compact, now)) ? { method: "totp" } : null;
  }

  const normalized = normalizeRecoveryCode(input);
  if (normalized.length !== 16) return null;
  const [used] = await executor
    .update(mfaRecoveryCodes)
    .set({ usedAt: now })
    .where(and(
      eq(mfaRecoveryCodes.userId, userId),
      eq(mfaRecoveryCodes.codeHash, hashRecoveryCode(normalized)),
      isNull(mfaRecoveryCodes.usedAt),
    ))
    .returning({ id: mfaRecoveryCodes.id });
  if (!used) return null;
  return { method: "recovery", recoveryCodesLeft: await countRecoveryCodes(executor, userId) };
}

/** Códigos novos (os antigos param de valer). Pede o código do autenticador, não um de recuperação. */
export async function regenerateRecoveryCodes(
  executor: Executor,
  userId: string,
  code: string,
  now = new Date(),
): Promise<string[] | null> {
  return executor.transaction(async (tx) => {
    if (!(await consumeTotp(tx, userId, code.replace(/\s/g, ""), now))) return null;
    return replaceRecoveryCodes(tx, userId, now);
  });
}

/**
 * Desliga o autenticador para cadastrar outro (celular novo). Pede um segundo
 * fator agora — código do app ou de recuperação: sessão roubada sozinha não
 * troca o autenticador de ninguém. Até o cadastro novo, o painel fecha.
 */
export async function removeAuthenticator(
  executor: Executor,
  userId: string,
  code: string,
  now = new Date(),
): Promise<boolean> {
  return executor.transaction(async (tx) => {
    if (!(await verifySecondFactor(tx, userId, code, now))) return false;
    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
    await tx.delete(mfaCredentials).where(eq(mfaCredentials.userId, userId));
    return true;
  });
}

async function consumeTotp(executor: Executor, userId: string, code: string, now: Date): Promise<boolean> {
  const credential = await executor.query.mfaCredentials.findFirst({
    where: and(eq(mfaCredentials.userId, userId), isNotNull(mfaCredentials.confirmedAt)),
    columns: { secret: true },
  });
  if (!credential) return false;
  const step = matchTotp(openSecret(credential.secret, userId), code, now);
  if (step === null) return false;

  // UPDATE condicional, não "lê e depois grava": é o banco que decide quem
  // usou o passo primeiro.
  const [accepted] = await executor
    .update(mfaCredentials)
    .set({ lastUsedStep: step })
    .where(and(
      eq(mfaCredentials.userId, userId),
      isNotNull(mfaCredentials.confirmedAt),
      or(isNull(mfaCredentials.lastUsedStep), lt(mfaCredentials.lastUsedStep, step)),
    ))
    .returning({ userId: mfaCredentials.userId });
  return Boolean(accepted);
}

async function replaceRecoveryCodes(executor: Executor, userId: string, now: Date): Promise<string[]> {
  // 80 bits cada (16 caracteres base32): nem com o hash na mão dá para adivinhar.
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => base32Encode(randomBytes(10)).match(/.{4}/g)!.join("-"));
  await executor.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
  await executor.insert(mfaRecoveryCodes).values(
    codes.map((code) => ({ userId, codeHash: hashRecoveryCode(normalizeRecoveryCode(code)), createdAt: now })),
  );
  return codes;
}

async function countRecoveryCodes(executor: Executor, userId: string): Promise<number> {
  const [row] = await executor
    .select({ value: count() })
    .from(mfaRecoveryCodes)
    .where(and(eq(mfaRecoveryCodes.userId, userId), isNull(mfaRecoveryCodes.usedAt)));
  return row?.value ?? 0;
}

/** Aceita como a pessoa digitar: minúscula, com ou sem hífen, com espaço. */
function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

function hashRecoveryCode(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex");
}
