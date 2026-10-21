"use client";

import { useState, useTransition } from "react";
import { addToCart } from "@/lib/actions/cart";

export function AddToCartButton({
  productId,
  variantId = null,
  disabled = false,
  className = "",
}: {
  productId: string;
  variantId?: string | null;
  disabled?: boolean;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [added, setAdded] = useState(false);

  return (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={() =>
        startTransition(async () => {
          const res = await addToCart({ productId, variantId, quantity: 1 });
          if (res.ok) {
            setAdded(true);
            setTimeout(() => setAdded(false), 1600);
          }
        })
      }
      className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${
        added
          ? "bg-deal text-deal-foreground"
          : "bg-violet text-white hover:bg-violet/90 disabled:bg-border disabled:text-foreground-muted"
      } ${className}`}
    >
      {added ? (
        <>
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M4 10.5l3.5 3.5L16 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Adicionado
        </>
      ) : (
        <>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
            <path d="M3 3h1.5l1.3 12.2a2 2 0 0 0 2 1.8h8.9a2 2 0 0 0 2-1.7L20 8H6" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="9.5" cy="20" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="17" cy="20" r="1.2" fill="currentColor" stroke="none" />
          </svg>
          {disabled ? "Esgotado" : pending ? "Adicionando…" : "Adicionar"}
        </>
      )}
    </button>
  );
}
