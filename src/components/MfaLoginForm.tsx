"use client";

import { useActionState } from "react";
import { FormAlert, buttonPrimary, fieldLabelClass, inputClass } from "@/components/Kit";
import { verifyLoginCode, type MfaLoginState } from "@/lib/actions/auth";

/** Segunda etapa do login: o mesmo campo aceita os 6 dígitos ou um código de recuperação. */
export function MfaLoginForm() {
  const [state, formAction, pending] = useActionState<MfaLoginState, FormData>(verifyLoginCode, undefined);

  return (
    <form action={formAction} className="mt-7 flex flex-col gap-4">
      {state?.message ? <FormAlert>{state.message}</FormAlert> : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="mfa-code" className={fieldLabelClass}>
          Código do autenticador
        </label>
        <input
          id="mfa-code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          required
          maxLength={24}
          className={`${inputClass} font-mono tracking-[0.2em]`}
          placeholder="000000"
        />
        <p className="text-xs leading-relaxed text-foreground-muted">
          Sem o celular? Digite um dos códigos de recuperação (formato XXXX-XXXX-XXXX-XXXX).
        </p>
      </div>
      <button type="submit" disabled={pending} className={`mt-2 w-full ${buttonPrimary}`}>
        {pending ? "Verificando…" : "Confirmar"}
      </button>
    </form>
  );
}
