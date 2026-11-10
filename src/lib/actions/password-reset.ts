"use server";

import { redirect } from "next/navigation";
import { breachedPasswordMessage } from "@/application/password-policy";
import {
  isPasswordResetLinkValid,
  limitPasswordResetAttempts,
  limitPasswordResetRequests,
  resetPassword,
} from "@/application/password-reset";
import { sendPasswordResetAfterResponse } from "@/composition/web";
import { retryMessage } from "@/lib/action-limits";
import { rememberThisDevice } from "@/lib/known-device";
import { getRequestIp } from "@/lib/request-ip";
import { parseForgotPasswordForm, parseResetPasswordForm } from "@/lib/validation/account";

export type ForgotPasswordState =
  | { sent?: boolean; message?: string; errors?: { email?: string }; values?: { email?: string } }
  | undefined;

/**
 * Pede o link. A resposta é a mesma exista a conta ou não — o trabalho de
 * verdade acontece depois dela (ver `application/password-reset.ts`).
 */
export async function requestPasswordReset(_prev: ForgotPasswordState, formData: FormData): Promise<ForgotPasswordState> {
  const echo = { email: String(formData.get("email") ?? "") };
  const parsed = parseForgotPasswordForm(formData);
  if (!parsed.ok) return { errors: parsed.errors, values: echo };

  const limit = await limitPasswordResetRequests(await getRequestIp());
  if (!limit.allowed) return { message: retryMessage(limit.retryAfterSeconds), values: echo };

  sendPasswordResetAfterResponse(parsed.values.email);
  return { sent: true };
}

const INVALID_LINK_MESSAGE = "Este link não vale mais: já foi usado, venceu ou foi trocado por um mais novo. Peça outro.";

export type ResetPasswordState = { message?: string; errors?: { password?: string; confirm?: string } } | undefined;

export async function resetPasswordWithLink(_prev: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const parsed = parseResetPasswordForm(formData);
  if (!parsed.ok) {
    if (parsed.errors.token) return { message: parsed.errors.token };
    return { errors: { password: parsed.errors.password, confirm: parsed.errors.confirm } };
  }

  const { token, password } = parsed.values;
  // Limite por IP antes de tocar no banco: a troca pelo link é pública e gasta
  // o token, então segura a varredura de tokens (anti-automação da OWASP).
  const limit = await limitPasswordResetAttempts(await getRequestIp());
  if (!limit.allowed) return { message: retryMessage(limit.retryAfterSeconds) };

  // O link primeiro (uma consulta ao banco): só quem tem um link válido faz o
  // site consultar o Pwned Passwords. Com senha vazada, o link não é gasto e a
  // pessoa escolhe outra nele mesmo.
  if (!(await isPasswordResetLinkValid(token))) return { message: INVALID_LINK_MESSAGE };
  const breached = await breachedPasswordMessage(password);
  if (breached) return { errors: { password: breached } };

  const result = await resetPassword({ token, password });
  if (!result) return { message: INVALID_LINK_MESSAGE };

  // Quem abriu o link provou ser dona do e-mail: este navegador passa a ser
  // conhecido, e o login aqui não esbarra no bloqueio da conta (se houver ataque).
  await rememberThisDevice(result.userId);
  redirect("/entrar?senha=redefinida");
}
