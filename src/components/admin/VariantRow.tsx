"use client";

import { useActionState, useState, useTransition } from "react";
import { removeVariant, type AdminFormState } from "@/lib/actions/admin";
import { VariantFields, type VariantDefaults } from "@/components/admin/VariantFields";
import { LOW_STOCK_MAX } from "@/lib/catalog-rules";
import { formatPriceCents } from "@/lib/format";

export function VariantRow({
  variantId,
  variant,
  action,
}: {
  variantId: string;
  variant: VariantDefaults & { name: string; sku: string; stockQuantity: number };
  action: (prev: AdminFormState, formData: FormData) => Promise<AdminFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [editing, setEditing] = useState(false);
  const [removing, startRemoving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-sm">
          <span className="font-medium">{variant.name}</span>
          <span className="ml-2 font-mono text-[11px] text-foreground-muted">{variant.sku}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-foreground-muted">
          <span className="tabular-nums">
            {variant.priceCents != null ? formatPriceCents(variant.priceCents) : "preço do produto"}
          </span>
          <span className={`tabular-nums ${variant.stockQuantity <= LOW_STOCK_MAX ? "text-foreground-muted" : ""}`}>
            estoque {variant.stockQuantity}
          </span>
          <button
            type="button"
            onClick={() => setEditing((value) => !value)}
            className="font-medium text-accent hover:underline"
          >
            {editing ? "Fechar" : "Editar"}
          </button>
          <button
            type="button"
            disabled={removing}
            onClick={() =>
              startRemoving(async () => {
                const result = await removeVariant(variantId);
                setError(result.ok ? null : result.error ?? "Erro.");
              })
            }
            className="font-medium hover:text-foreground disabled:opacity-50"
          >
            {removing ? "…" : "Remover"}
          </button>
        </div>
      </div>

      {error ? <p className="mt-2 text-[11px] text-foreground">{error}</p> : null}

      {editing ? (
        <form action={formAction} className="mt-3 border-t border-border pt-3">
          {state?.message ? (
            <p className="mb-2 rounded-lg border border-signal bg-signal px-2.5 py-1.5 text-xs text-on-signal">
              {state.message}
            </p>
          ) : null}
          <VariantFields defaults={variant} errors={state?.errors ?? {}} />
          <button
            type="submit"
            disabled={pending}
            className="mt-3 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {pending ? "Salvando…" : "Salvar variante"}
          </button>
        </form>
      ) : null}
    </li>
  );
}
