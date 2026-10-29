"use client";

import { useState } from "react";
import { buttonCompact } from "@/components/Kit";
import { formatPriceCents } from "@/lib/format";

type Coupon = {
  code: string;
  description: string | null;
  discountType: "percentage" | "fixed";
  discountValue: number;
  minOrderCents: number;
};

function CouponCard({ coupon }: { coupon: Coupon }) {
  const [copied, setCopied] = useState(false);
  const value =
    coupon.discountType === "percentage"
      ? `${coupon.discountValue}%`
      : formatPriceCents(coupon.discountValue);

  function copy() {
    navigator.clipboard?.writeText(coupon.code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  }

  return (
    <div className="dys-frame flex items-center justify-between gap-5 px-5 py-4">
      <div className="min-w-0">
        <span className="font-mono text-2xl font-semibold text-foreground">-{value}</span>
        <p className="label mt-1 truncate text-foreground-muted">
          {coupon.minOrderCents > 0
            ? `Acima de ${formatPriceCents(coupon.minOrderCents)}`
            : coupon.description ?? "Sem mínimo"}
        </p>
      </div>
      <button
        type="button"
        onClick={copy}
        className="flex flex-col items-start border border-foreground px-3 py-2 hover:bg-foreground hover:text-background"
        aria-label={`Copiar cupom ${coupon.code}`}
      >
        <span className="serial">{coupon.code}</span>
        <span className="label text-[10px] opacity-70">{copied ? "Copiado" : "Copiar código"}</span>
      </button>
    </div>
  );
}

/**
 * Cupons em vigor, logo abaixo do botão de comprar: é onde quem está decidindo
 * a compra olha (no fim da página, depois da ficha técnica, ninguém via).
 */
const VISIBLE = 3;

export function CouponStrip({ coupons }: { coupons: Coupon[] }) {
  const [expanded, setExpanded] = useState(false);
  if (coupons.length === 0) return null;
  // Os mais fáceis de usar primeiro (menor pedido mínimo); três à vista para
  // não empurrar a página, o resto a um clique.
  const sorted = [...coupons].sort((a, b) => a.minOrderCents - b.minOrderCents);
  const shown = expanded ? sorted : sorted.slice(0, VISIBLE);
  const hidden = sorted.length - shown.length;
  return (
    <section aria-labelledby="cupons-titulo" className="flex flex-col gap-3">
      <h2 id="cupons-titulo" className="label text-foreground-muted">
        Cupons em vigor <span className="text-foreground">· use no checkout</span>
      </h2>
      <ul className="flex flex-col gap-3">
        {shown.map((c) => (
          <li key={c.code}>
            <CouponCard coupon={c} />
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <button type="button" onClick={() => setExpanded(true)} className={`self-start ${buttonCompact}`}>
          Ver mais {hidden} {hidden === 1 ? "cupom" : "cupons"}
        </button>
      ) : null}
    </section>
  );
}
