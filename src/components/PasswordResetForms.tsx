"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FieldError, FormAlert, buttonPrimary, fieldLabelClass, inputClass } from "@/components/Kit";
import {
  requestPasswordReset,
  resetPasswordWithLink,
  type ForgotPasswordState,
  type ResetPasswordState,
} from "@/lib/actions/password-reset";

/** Pede o link. Depois de enviar, a resposta é a mesma para qualquer e-mail. */
export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<ForgotPasswordState, FormData>(requestPasswordReset, undefined);

  if (state?.sent) {
    return (
      <div role="status" className="mt-7 flex flex-col gap-3 border border-foreground px-4 py-4 text-sm text-foreground">
        <p>
          Se existir uma conta com esse e-mail, enviamos um link para escolher uma senha nova. Ele vale 30 minutos e
          funciona uma vez só.
        </p>
        <p className="text-foreground-muted">Não chegou em alguns minutos? Confira o spam ou peça de novo.</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-7 flex flex-col gap-4" noValidate>
      {state?.message ? <FormAlert>{state.message}</FormAlert> : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className={fieldLabelClass}>
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state?.values?.email ?? ""}
          className={inputClass}
          placeholder="voce@exemplo.com"
        />
        <FieldError message={state?.errors?.email} />
      </div>
      <button type="submit" disabled={pending} className={`mt-2 w-full ${buttonPrimary}`}>
        {pending ? "Enviando…" : "Enviar link"}
      </button>
    </form>
  );
}

/** Senha nova pelo link. O token vai escondido no formulário (não na URL do POST). */
export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<ResetPasswordState, FormData>(resetPasswordWithLink, undefined);

  return (
    <form action={formAction} className="mt-7 flex flex-col gap-4" noValidate>
      {state?.message ? (
        <FormAlert>
          {state.message}{" "}
          <Link href="/entrar/esqueci" className="underline underline-offset-4">
            Pedir outro link
          </Link>
        </FormAlert>
      ) : null}
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className={fieldLabelClass}>
          Senha nova
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          className={inputClass}
          placeholder="Mín. 8 caracteres"
        />
        <FieldError message={state?.errors?.password} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirm" className={fieldLabelClass}>
          Repita a senha nova
        </label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" className={inputClass} />
        <FieldError message={state?.errors?.confirm} />
      </div>
      <button type="submit" disabled={pending} className={`mt-2 w-full ${buttonPrimary}`}>
        {pending ? "Salvando…" : "Salvar senha nova"}
      </button>
    </form>
  );
}
