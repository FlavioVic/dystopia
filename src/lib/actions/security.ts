"use server";

/**
 * Segurança da conta (`/conta/seguranca`): sair dos outros aparelhos e o
 * autenticador do admin. O autenticador fica só para admin de propósito: a
 * conta demo de cliente tem senha pública, e qualquer visitante que ligasse
 * MFA nela trancaria todos os outros para fora.
 */

import QRCode from "qrcode";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { limitAction } from "@/lib/action-limits";
import { getCurrentUser, type CurrentUser } from "@/lib/data/auth";
import { readSessionToken } from "@/lib/session";
import { PermanentError } from "@/saga/errors";
import { beginEnrollment, confirmEnrollment, regenerateRecoveryCodes, removeAuthenticator } from "@/services/mfa";
import { base32Encode, otpauthUri } from "@/services/mfa/totp";
import { revokeOtherSessions } from "@/services/sessions";

/** Nome que aparece no app autenticador, acima do e-mail. */
const TOTP_ISSUER = "DYSTOPIA";

export type SessionsState = { message?: string } | undefined;

export async function signOutOtherDevices(): Promise<SessionsState> {
  const user = await getCurrentUser();
  const token = await readSessionToken();
  if (!user || !token) redirect("/entrar");
  const removed = await revokeOtherSessions(db, user.id, token);
  return { message: removed === 0 ? "Nenhum outro aparelho estava conectado." : `${removed} ${removed === 1 ? "sessão encerrada" : "sessões encerradas"}.` };
}

export type MfaStartState = { qrDataUrl: string; manualKey: string } | { message: string } | undefined;
export type MfaConfirmState = { recoveryCodes: string[] } | { message: string } | undefined;

async function requireAdminAccount(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") redirect("/entrar");
  return user;
}

/** Gera o segredo e devolve o QR. O segredo em claro só existe nesta resposta. */
export async function startMfaEnrollment(): Promise<MfaStartState> {
  const user = await requireAdminAccount();
  let secret: Buffer;
  try {
    secret = await beginEnrollment(db, user.id);
  } catch (error) {
    if (error instanceof PermanentError) return { message: error.message };
    throw error;
  }
  const uri = otpauthUri({ secret, account: user.email, issuer: TOTP_ISSUER });
  const svg = await QRCode.toString(uri, { type: "svg", margin: 2, errorCorrectionLevel: "M" });
  return {
    qrDataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    manualKey: base32Encode(secret).match(/.{1,4}/g)!.join(" "),
  };
}

/**
 * Primeiro código certo liga o MFA. As outras sessões da conta caem: foram
 * abertas só com senha, e a partir de agora senha sozinha não basta.
 */
export async function confirmMfaEnrollment(_prev: MfaConfirmState, formData: FormData): Promise<MfaConfirmState> {
  const user = await requireAdminAccount();
  const token = await readSessionToken();
  if (!token) redirect("/entrar");

  const limited = (await limitAction("mfa", `user:${user.id}`)) ?? (await limitAction("mfaDaily", `user:${user.id}`));
  if (limited) return { message: limited };

  try {
    const codes = await db.transaction(async (tx) => {
      const confirmed = await confirmEnrollment(tx, user.id, String(formData.get("code") ?? ""));
      if (confirmed) await revokeOtherSessions(tx, user.id, token);
      return confirmed;
    });
    if (!codes) return { message: "Código não confere. Confira a hora do celular e digite o código que está na tela agora." };
    return { recoveryCodes: codes };
  } catch (error) {
    if (error instanceof PermanentError) return { message: error.message };
    throw error;
  }
}

export type RecoveryCodesState = { recoveryCodes?: string[]; message?: string } | undefined;

/** Códigos de recuperação novos (os antigos param de valer). Pede o código do autenticador. */
export async function newRecoveryCodes(_prev: RecoveryCodesState, formData: FormData): Promise<RecoveryCodesState> {
  const user = await requireAdminAccount();
  const limited = (await limitAction("mfa", `user:${user.id}`)) ?? (await limitAction("mfaDaily", `user:${user.id}`));
  if (limited) return { message: limited };

  const codes = await regenerateRecoveryCodes(db, user.id, String(formData.get("code") ?? ""));
  if (!codes) return { message: "Código inválido ou já usado." };
  return { recoveryCodes: codes };
}

export type ReplaceAuthenticatorState = { message?: string } | undefined;

/** Celular novo: confirma com um fator agora, apaga o autenticador e volta para o cadastro. */
export async function replaceAuthenticator(
  _prev: ReplaceAuthenticatorState,
  formData: FormData,
): Promise<ReplaceAuthenticatorState> {
  const user = await requireAdminAccount();
  const limited = (await limitAction("mfa", `user:${user.id}`)) ?? (await limitAction("mfaDaily", `user:${user.id}`));
  if (limited) return { message: limited };

  if (!(await removeAuthenticator(db, user.id, String(formData.get("code") ?? "")))) {
    return { message: "Código inválido ou já usado." };
  }
  redirect("/conta/seguranca");
}
