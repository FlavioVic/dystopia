"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AdminFormState } from "@/lib/actions/admin";

type Cat = { id: string; name: string };
type Defaults = {
  name?: string;
  slug?: string;
  sku?: string;
  brand?: string | null;
  categoryId?: string;
  price?: string;
  compareAt?: string;
  stock?: string;
  description?: string;
  isActive?: boolean;
  isFeatured?: boolean;
};

const input =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-foreground-muted focus:border-foreground";
const label = "text-[11px] font-medium uppercase tracking-wide text-foreground-muted";

export function ProductForm({
  action,
  categories,
  defaults = {},
  mode,
}: {
  action: (prev: AdminFormState, fd: FormData) => Promise<AdminFormState>;
  categories: Cat[];
  defaults?: Defaults;
  mode: "create" | "edit";
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const e = state?.errors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state?.message ? (
        <p className="rounded-lg border border-signal bg-signal px-3 py-2 text-sm text-on-signal">
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="name" label="Nome" defaultValue={defaults.name} error={e.name} className="sm:col-span-2" />
        <Field name="slug" label="Slug (URL)" defaultValue={defaults.slug} error={e.slug} />
        <Field name="sku" label="SKU" defaultValue={defaults.sku} error={e.sku} />
        <Field name="brand" label="Marca (opcional)" defaultValue={defaults.brand ?? ""} />
        <div className="flex flex-col gap-1">
          <label htmlFor="categoryId" className={label}>Categoria</label>
          <select id="categoryId" name="categoryId" defaultValue={defaults.categoryId ?? ""} className={input}>
            <option value="" disabled>Escolha…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {e.categoryId ? <span className="text-[11px] text-foreground">{e.categoryId}</span> : null}
        </div>
        <Field name="price" label="Preço (R$)" type="number" step="0.01" defaultValue={defaults.price} error={e.price} />
        <Field name="compareAt" label='Preço "de" (opcional)' type="number" step="0.01" defaultValue={defaults.compareAt} error={e.compareAt} />
        <Field name="stock" label="Estoque" type="number" defaultValue={defaults.stock} error={e.stock} />
        {mode === "create" ? (
          <p className="text-xs text-foreground-muted sm:col-span-2">As fotos entram depois de criar, na edição do produto.</p>
        ) : null}
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label htmlFor="description" className={label}>Descrição</label>
          <textarea id="description" name="description" rows={4} defaultValue={defaults.description} className={input} />
          {e.description ? <span className="text-[11px] text-foreground">{e.description}</span> : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-5">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isActive" defaultChecked={defaults.isActive ?? true} className="accent-[var(--accent)]" />
          Ativo (visível na loja)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isFeatured" defaultChecked={defaults.isFeatured ?? false} className="accent-[var(--accent)]" />
          Destaque na home
        </label>
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-primary px-5 py-2.5 label text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Salvando…" : mode === "create" ? "Criar produto" : "Salvar alterações"}
        </button>
        <Link href="/admin/produtos" className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium hover:border-border-hover">
          Cancelar
        </Link>
      </div>
    </form>
  );
}

function Field({
  name,
  label: labelText,
  error,
  className = "",
  ...rest
}: {
  name: string;
  label: string;
  error?: string;
  className?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={name} className={label}>{labelText}</label>
      <input id={name} name={name} className={input} {...rest} />
      {error ? <span className="text-[11px] text-foreground">{error}</span> : null}
    </div>
  );
}
