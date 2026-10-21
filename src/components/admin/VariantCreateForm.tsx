"use client";

import { useActionState } from "react";
import type { AdminFormState } from "@/lib/actions/admin";
import { VariantFields } from "@/components/admin/VariantFields";

export function VariantCreateForm({
  action,
}: {
  action: (prev: AdminFormState, formData: FormData) => Promise<AdminFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="rounded-xl border border-dashed border-border p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
        Nova variante
      </p>

      {state?.message ? (
        <p className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
          {state.message}
        </p>
      ) : null}

      <div className="mt-2.5">
        <VariantFields errors={state?.errors ?? {}} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-3 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground disabled:opacity-50"
      >
        {pending ? "Adicionando…" : "Adicionar variante"}
      </button>
    </form>
  );
}
