"use client";

import { useState } from "react";
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
    <div className="relative flex shrink-0 items-center gap-3 overflow-hidden rounded-xl border border-violet/25 bg-violet/5 p-3 pl-4">
      <span className="absolute left-0 top-0 h-full w-1.5 gradient-brand" aria-hidden />
      <div className="min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="font-brand text-lg font-bold text-violet">{value}</span>
          <span className="text-xs text-foreground-muted">OFF</span>
        </div>
        <p className="truncate text-[11px] text-foreground-muted">
          {coupon.minOrderCents > 0
            ? `Acima de ${formatPriceCents(coupon.minOrderCents)}`
            : coupon.description ?? "Sem mínimo"}
        </p>
      </div>
      <button
        type="button"
        onClick={copy}
        className="flex items-center gap-1.5 rounded-lg border border-dashed border-violet/50 bg-background px-2.5 py-1.5 font-mono text-xs font-bold text-violet transition-colors hover:bg-violet/10"
        aria-label={`Copiar cupom ${coupon.code}`}
      >
        {coupon.code}
        <span className="text-[10px] font-sans font-semibold uppercase tracking-wide text-foreground-muted">
          {copied ? "copiado ✓" : "copiar"}
        </span>
      </button>
    </div>
  );
}

export function CouponStrip({ coupons }: { coupons: Coupon[] }) {
  if (coupons.length === 0) return null;
  return (
    <section className="mt-12 border-t border-border pt-8">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-foreground-muted">
        <span aria-hidden>🎟️</span> Cupons disponíveis
      </h2>
      <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
        {coupons.map((c) => (
          <CouponCard key={c.code} coupon={c} />
        ))}
      </div>
    </section>
  );
}
