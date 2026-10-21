"use client";

import { useActionState } from "react";
import { saveAddress, type AddressState } from "@/lib/actions/addresses";

const input =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-foreground-muted focus:border-accent";
const label = "text-[11px] font-medium uppercase tracking-wide text-foreground-muted";

/** Cadastro de endereço na conta. Mesma validação do checkout (`validation/address`). */
export function AddressForm({ hasAddresses }: { hasAddresses: boolean }) {
  const [state, formAction, pending] = useActionState<AddressState, FormData>(saveAddress, undefined);
  const errors = state?.errors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-xl border border-border bg-background-elevated p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
        Novo endereço
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="label" label="Apelido" placeholder="Casa, Trabalho…" error={errors.label} />
        <Field name="recipientName" label="Destinatário" error={errors.recipientName} />
        <Field name="zipCode" label="CEP" placeholder="00000-000" error={errors.zipCode} />
        <Field name="street" label="Rua" error={errors.street} />
        <Field name="number" label="Número" error={errors.number} />
        <Field name="complement" label="Complemento (opcional)" />
        <Field name="neighborhood" label="Bairro" error={errors.neighborhood} />
        <Field name="city" label="Cidade" error={errors.city} />
        <Field name="state" label="UF" placeholder="SP" maxLength={2} error={errors.state} />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isDefault"
          defaultChecked={!hasAddresses}
          className="accent-[var(--accent)]"
        />
        Usar como endereço padrão
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
        >
          {pending ? "Salvando…" : "Salvar endereço"}
        </button>
        {state?.ok ? <span className="text-xs text-success">{state.message}</span> : null}
        {state?.message && !state.ok ? (
          <span className="text-xs text-danger">{state.message}</span>
        ) : null}
      </div>
    </form>
  );
}

function Field({
  name,
  label: labelText,
  error,
  ...rest
}: { name: string; label: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`address-${name}`} className={label}>
        {labelText}
      </label>
      <input id={`address-${name}`} name={name} className={input} {...rest} />
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}
    </div>
  );
}
