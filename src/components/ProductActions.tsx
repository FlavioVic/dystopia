"use client";

import { useMemo, useState, useTransition } from "react";
import { addToCart } from "@/lib/actions/cart";
import {
  discountPercent,
  formatPriceCents,
  installmentText,
} from "@/lib/format";

type Variant = {
  id: string;
  name: string;
  priceCents: number | null;
  stockQuantity: number;
  attributes: Record<string, string>;
};

// Garantias ditas como protocolo, sem ícone (a marca não tem conjunto de ícones).
const protocols = [
  { code: "P-01", label: "Garantia do fabricante" },
  { code: "P-02", label: "Envio registrado" },
  { code: "P-03", label: "Pagamento protegido" },
];

export function ProductActions({
  productId,
  basePriceCents,
  compareAtPriceCents,
  baseStock,
  variants,
}: {
  productId: string;
  basePriceCents: number;
  compareAtPriceCents: number | null;
  baseStock: number;
  variants: Variant[];
}) {
  const [selectedVariantId, setSelectedVariantId] = useState(variants[0]?.id ?? null);
  const [quantity, setQuantity] = useState(1);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedVariant = variants.find((v) => v.id === selectedVariantId) ?? null;
  const priceCents = selectedVariant?.priceCents ?? basePriceCents;
  const stock = variants.length > 0 ? (selectedVariant?.stockQuantity ?? 0) : baseStock;
  const outOfStock = stock <= 0;
  const lowStock = !outOfStock && stock <= 3;
  const maxQuantity = Math.min(stock, 10);

  const discount = discountPercent(priceCents, compareAtPriceCents);
  const installment = installmentText(priceCents);

  const groupedAttributeLabel = useMemo(() => {
    if (variants.length === 0) return null;
    const keys = new Set<string>();
    variants.forEach((v) => Object.keys(v.attributes).forEach((k) => keys.add(k)));
    return Array.from(keys)[0] ?? "opção";
  }, [variants]);

  return (
    <div className="border border-border bg-background-elevated p-6">
      <div className="flex flex-col gap-1.5">
        {compareAtPriceCents && discount ? (
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-foreground-muted line-through">
              {formatPriceCents(compareAtPriceCents)}
            </span>
            <span className="dys-label dys-label--classified">-{discount}%</span>
          </div>
        ) : null}
        <span className="font-mono text-4xl font-semibold leading-tight text-foreground">
          {formatPriceCents(priceCents)}
        </span>
        {installment ? <span className="text-sm text-foreground-muted">{installment}</span> : null}
      </div>

      {variants.length > 0 ? (
        <fieldset className="mt-6 flex flex-col gap-3">
          <legend className="label mb-3 text-foreground-muted">{groupedAttributeLabel}</legend>
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-pressed={v.id === selectedVariantId}
                onClick={() => {
                  setSelectedVariantId(v.id);
                  setFeedback(null);
                }}
                disabled={v.stockQuantity <= 0}
                className={`border px-3 py-2 font-mono text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                  v.id === selectedVariantId
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-foreground hover:border-foreground"
                }`}
              >
                {v.name}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="mt-6 flex items-center gap-4">
        <span className="label text-foreground-muted">Quantidade</span>
        <div className="flex items-center border border-border">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            className="flex h-9 w-9 items-center justify-center font-mono text-foreground-muted hover:text-foreground"
            aria-label="Diminuir quantidade"
          >
            −
          </button>
          <span className="w-9 text-center font-mono text-sm">{String(quantity).padStart(2, "0")}</span>
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
            disabled={quantity >= maxQuantity}
            className="flex h-9 w-9 items-center justify-center font-mono text-foreground-muted hover:text-foreground disabled:opacity-40"
            aria-label="Aumentar quantidade"
          >
            +
          </button>
        </div>
        <span className="label text-foreground-muted">
          {outOfStock ? "Sem estoque" : lowStock ? `Últimas ${String(stock).padStart(2, "0")}` : `${stock} em estoque`}
        </span>
      </div>

      <button
        type="button"
        disabled={outOfStock || isPending}
        onClick={() =>
          startTransition(async () => {
            setFeedback(null);
            const res = await addToCart({ productId, variantId: selectedVariantId, quantity });
            setFeedback(
              res.ok
                ? { ok: true, msg: "Registrado no carrinho." }
                : { ok: false, msg: res.error ?? "A operação foi recusada." },
            );
          })
        }
        className="label mt-6 flex w-full items-center justify-center bg-primary px-5 py-4 text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {outOfStock ? "Sem estoque" : isPending ? "Registrando…" : "Adicionar ao carrinho"}
      </button>

      {feedback ? (
        <p role="status" className="mt-3 text-sm text-foreground">
          {feedback.ok ? feedback.msg : <span className="dys-label dys-label--restricted">{feedback.msg}</span>}
        </p>
      ) : null}

      <ul className="mt-6 grid grid-cols-1 gap-2 border-t border-border-faint pt-5 sm:grid-cols-3">
        {protocols.map((p) => (
          <li key={p.code} className="flex flex-col gap-1">
            <span className="serial text-foreground-muted">{p.code}</span>
            <span className="text-xs text-foreground-muted">{p.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
