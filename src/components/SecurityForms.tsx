"use client";

import { useActionState } from "react";
import { FormAlert, buttonSecondary, fieldLabelClass, inputClass } from "@/components/Kit";
import { RecoveryCodes } from "@/components/RecoveryCodes";
import {
  newRecoveryCodes,
  replaceAuthenticator,
  signOutOtherDevices,
  type RecoveryCodesState,
  type ReplaceAuthenticatorState,
  type SessionsState,
} from "@/lib/actions/security";

export function SignOutOthersForm() {
  const [state, formAction, pending] = useActionState<SessionsState, FormData>(signOutOtherDevices, undefined);
  return (
    <form action={formAction} className="flex flex-col items-start gap-3">
      {state?.message ? (
        <p role="status" className="text-sm text-foreground">
          {state.message}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={buttonSecondary}>
        {pending ? "Encerrando…" : "Sair dos outros aparelhos"}
      </button>
    </form>
  );
}

/** Códigos novos de recuperação: pede o código do autenticador (não um de recuperação). */
export function NewRecoveryCodesForm() {
  const [state, formAction, pending] = useActionState<RecoveryCodesState, FormData>(newRecoveryCodes, undefined);
  if (state?.recoveryCodes) return <RecoveryCodes codes={state.recoveryCodes} />;
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state?.message ? <FormAlert>{state.message}</FormAlert> : null}
      <label htmlFor="recovery-code-totp" className={fieldLabelClass}>
        Código do autenticador
      </label>
      <div className="flex flex-wrap gap-3">
        <input
          id="recovery-code-totp"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          className={`${inputClass} max-w-48 font-mono tracking-[0.2em]`}
          placeholder="000000"
        />
        <button type="submit" disabled={pending} className={buttonSecondary}>
          {pending ? "Gerando…" : "Gerar códigos novos"}
        </button>
      </div>
      <p className="text-xs text-foreground-muted">Os códigos antigos param de valer.</p>
    </form>
  );
}

/** Trocar de celular: um fator agora (app ou recuperação) e o cadastro recomeça. */
export function ReplaceAuthenticatorForm() {
  const [state, formAction, pending] = useActionState<ReplaceAuthenticatorState, FormData>(replaceAuthenticator, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state?.message ? <FormAlert>{state.message}</FormAlert> : null}
      <label htmlFor="replace-authenticator-code" className={fieldLabelClass}>
        Código do app ou de recuperação
      </label>
      <div className="flex flex-wrap gap-3">
        <input
          id="replace-authenticator-code"
          name="code"
          type="text"
          autoComplete="one-time-code"
          maxLength={24}
          required
          className={`${inputClass} max-w-64 font-mono`}
        />
        <button type="submit" disabled={pending} className={buttonSecondary}>
          {pending ? "Conferindo…" : "Trocar de aparelho"}
        </button>
      </div>
      <p className="text-xs text-foreground-muted">
        O autenticador atual e os códigos de recuperação deixam de valer; o painel fica fechado até você cadastrar o
        aparelho novo, logo em seguida.
      </p>
    </form>
  );
}
