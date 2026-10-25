"use client";

import { useActionState, useState } from "react";
import { FormAlert, fieldLabelClass, inputClass } from "@/components/Kit";
import { deleteMyAccount, type DeleteAccountState } from "@/lib/actions/account";

/** Fechado por padrão: abrir, ler o que some e confirmar com a senha. */
export function DeleteAccountForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<DeleteAccountState, FormData>(deleteMyAccount, undefined);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="label min-h-6 text-foreground-muted underline underline-offset-4 hover:text-foreground"
      >
        Excluir minha conta
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4 border border-signal p-5">
      <p className="text-sm leading-relaxed text-foreground">
        Apaga de vez a conta, os endereços, os pedidos, as avaliações, os favoritos, os pedidos de orçamento e os
        e-mails enviados para você. Não dá para desfazer.
      </p>
      {state?.message ? <FormAlert>{state.message}</FormAlert> : null}
      <div>
        <label htmlFor="excluir-senha" className={fieldLabelClass}>
          Confirme com sua senha
        </label>
        <input
          id="excluir-senha"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className={`${inputClass} mt-2`}
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={pending}
          className="label inline-flex items-center justify-center bg-signal px-5 py-3 text-on-signal disabled:opacity-50"
        >
          {pending ? "Excluindo…" : "Excluir conta"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="label inline-flex items-center justify-center border border-border px-5 py-3 text-foreground"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
