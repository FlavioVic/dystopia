"use client";

import { useState, useTransition } from "react";
import { toggleCouponActive } from "@/lib/actions/admin";

export function CouponActions({ couponId, isActive }: { couponId: string; isActive: boolean }) {
  const [active, setActive] = useState(isActive);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await toggleCouponActive(couponId);
            if (result.ok) {
              setActive((value) => !value);
              setError(null);
              return;
            }
            setError(result.error ?? "Erro.");
          })
        }
        className={`label border px-2.5 py-1 disabled:opacity-50 ${
          active
            ? "border border-foreground text-foreground"
            : "bg-background-elevated-hover text-foreground-muted hover:text-foreground"
        }`}
      >
        {active ? "Ativo" : "Inativo"}
      </button>
      {error ? <span className="text-[11px] text-foreground">{error}</span> : null}
    </span>
  );
}
