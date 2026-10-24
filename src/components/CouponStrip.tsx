"use client";

import { useState } from "react";
import { Rule } from "@/components/Kit";
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
    <div className="dys-frame flex shrink-0 items-center gap-5 px-5 py-4">
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

export function CouponStrip({ coupons }: { coupons: Coupon[] }) {
  if (coupons.length === 0) return null;
  return (
    <section className="mt-16">
      <Rule label="Diretivas em vigor" index={`${String(coupons.length).padStart(2, "0")} códigos`} />
      <div className="mt-6 flex gap-4 overflow-x-auto pb-1">
        {coupons.map((c) => (
          <CouponCard key={c.code} coupon={c} />
        ))}
      </div>
    </section>
  );
}
