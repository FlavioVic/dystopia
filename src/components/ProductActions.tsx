"use client";

import { useMemo, useState, useTransition } from "react";
import { addToCart } from "@/lib/actions/cart";
import {
  discountPercent,
  formatPriceCents,
  installmentText,
  isFreeShipping,
} from "@/lib/format";

type Variant = {
  id: string;
  name: string;
  priceCents: number | null;
  stockQuantity: number;
  attributes: Record<string, string>;
};

const trust = [
  { label: "Bom atendimento", d: "M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8z" },
  { label: "Embalagem segura", d: "M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8" },
  { label: "Compra protegida", d: "M12 3l7 3v5c0 4.4-3 8-7 10-4-2-7-5.6-7-10V6z" },
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
  const freeShip = isFreeShipping(priceCents);

  const groupedAttributeLabel = useMemo(() => {
    if (variants.length === 0) return null;
    const keys = new Set<string>();
    variants.forEach((v) => Object.keys(v.attributes).forEach((k) => keys.add(k)));
    return Array.from(keys)[0] ?? "opção";
  }, [variants]);

  return (
    <div className="rounded-2xl border border-border bg-background-elevated p-5 shadow-sm">
      {/* Preço */}
      <div className="flex flex-col gap-1">
        {compareAtPriceCents && discount ? (
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-foreground-muted line-through">
              {formatPriceCents(compareAtPriceCents)}
            </span>
            <span className="rounded-md bg-deal px-2 py-0.5 text-xs font-bold text-deal-foreground">
              {discount}% OFF
            </span>
          </div>
        ) : null}
        <span className="font-mono text-3xl font-bold text-accent">{formatPriceCents(priceCents)}</span>
        {installment ? <span className="text-sm text-foreground-muted">{installment}</span> : null}
      </div>

      {/* Chips */}
      {(freeShip || lowStock) && !outOfStock ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {freeShip ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-deal-soft px-2.5 py-1.5 text-xs font-semibold text-success">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 7h10v8H3zM13 10h4l3 3v2h-7z" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="7" cy="17" r="1.6" />
                <circle cx="17" cy="17" r="1.6" />
              </svg>
              Frete grátis
            </span>
          ) : null}
          {lowStock ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-bright/15 px-2.5 py-1.5 text-xs font-semibold text-accent-secondary">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
                <path d="M13 2L4.5 13.5H11l-1 8L19.5 10H13z" />
              </svg>
              Última{stock === 1 ? " unidade" : "s unidades"}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Variantes */}
      {variants.length > 0 ? (
        <div className="mt-5 flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
            {groupedAttributeLabel}
          </span>
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  setSelectedVariantId(v.id);
                  setFeedback(null);
                }}
                disabled={v.stockQuantity <= 0}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  v.id === selectedVariantId
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-foreground hover:border-border-hover"
                }`}
              >
                {v.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Quantidade */}
      <div className="mt-5 flex items-center gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Qtd</span>
        <div className="flex items-center rounded-lg border border-border">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            className="flex h-9 w-9 items-center justify-center text-foreground-muted hover:text-foreground"
            aria-label="Diminuir quantidade"
          >
            −
          </button>
          <span className="w-8 text-center text-sm tabular-nums">{quantity}</span>
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
            disabled={quantity >= maxQuantity}
            className="flex h-9 w-9 items-center justify-center text-foreground-muted hover:text-foreground disabled:opacity-40"
            aria-label="Aumentar quantidade"
          >
            +
          </button>
        </div>
        <span className="text-xs text-foreground-muted">
          {outOfStock ? "Esgotado" : `${stock} em estoque`}
        </span>
      </div>

      {/* CTA */}
      <button
        type="button"
        disabled={outOfStock || isPending}
        onClick={() =>
          startTransition(async () => {
            setFeedback(null);
            const res = await addToCart({ productId, variantId: selectedVariantId, quantity });
            setFeedback(
              res.ok
                ? { ok: true, msg: "Adicionado ao carrinho." }
                : { ok: false, msg: res.error ?? "Não foi possível adicionar." },
            );
          })
        }
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3.5 text-sm font-bold text-accent-foreground transition-transform enabled:hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.9">
          <path d="M3 3h1.5l1.3 12.2a2 2 0 0 0 2 1.8h8.9a2 2 0 0 0 2-1.7L20 8H6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="9.5" cy="20" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="17" cy="20" r="1.3" fill="currentColor" stroke="none" />
        </svg>
        {outOfStock ? "Produto esgotado" : isPending ? "Adicionando…" : "Adicionar ao carrinho"}
      </button>

      {feedback ? (
        <p className={`mt-2 text-center text-xs ${feedback.ok ? "text-success" : "text-danger"}`}>
          {feedback.msg}
        </p>
      ) : null}

      {/* Selos de confiança */}
      <div className="mt-5 grid grid-cols-3 gap-2 border-t border-border pt-4">
        {trust.map((t) => (
          <div key={t.label} className="flex flex-col items-center gap-1.5 text-center">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-violet" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d={t.d} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-[11px] leading-tight text-foreground-muted">{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
