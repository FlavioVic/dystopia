"use client";

import { formatAttributes } from "@/lib/validation/variant";

export const variantInput =
  "w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none transition-colors placeholder:text-foreground-muted focus:border-accent";
export const variantLabel = "text-[10px] font-medium uppercase tracking-wide text-foreground-muted";

export type VariantDefaults = {
  name?: string;
  sku?: string;
  priceCents?: number | null;
  stockQuantity?: number;
  attributes?: unknown;
};

/** Campos compartilhados entre criar e editar variante. */
export function VariantFields({
  defaults = {},
  errors = {},
}: {
  defaults?: VariantDefaults;
  errors?: Record<string, string>;
}) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-6">
      <Field
        className="sm:col-span-2"
        name="name"
        label="Nome"
        placeholder="M / Preto"
        defaultValue={defaults.name}
        error={errors.name}
      />
      <Field
        className="sm:col-span-2"
        name="sku"
        label="SKU"
        placeholder="SKU-M-PRETO"
        defaultValue={defaults.sku}
        error={errors.sku}
      />
      <Field
        className="sm:col-span-1"
        name="price"
        label="Preço (R$)"
        placeholder="herda"
        defaultValue={defaults.priceCents != null ? (defaults.priceCents / 100).toFixed(2) : ""}
        error={errors.price}
      />
      <Field
        className="sm:col-span-1"
        name="stock"
        label="Estoque"
        defaultValue={defaults.stockQuantity != null ? String(defaults.stockQuantity) : "0"}
        error={errors.stock}
      />
      <div className="flex flex-col gap-1 sm:col-span-6">
        <label className={variantLabel}>Atributos (um por linha, &quot;chave: valor&quot;)</label>
        <textarea
          name="attributes"
          rows={2}
          placeholder={"Tamanho: M\nCor: Preto"}
          defaultValue={formatAttributes(defaults.attributes)}
          className={variantInput}
        />
      </div>
    </div>
  );
}

function Field({
  name,
  label,
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
      <label htmlFor={`variant-${name}-${rest.defaultValue ?? "new"}`} className={variantLabel}>
        {label}
      </label>
      <input
        id={`variant-${name}-${rest.defaultValue ?? "new"}`}
        name={name}
        className={variantInput}
        {...rest}
      />
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}
    </div>
  );
}
