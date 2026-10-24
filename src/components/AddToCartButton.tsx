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
      className={`label flex w-full items-center justify-center px-4 py-3 disabled:cursor-not-allowed ${
        added
          ? "border border-foreground text-foreground"
          : "bg-primary text-primary-foreground hover:bg-primary-hover disabled:bg-background-elevated disabled:text-foreground-muted"
      } ${className}`}
    >
      {added ? "Registrado no carrinho" : disabled ? "Sem estoque" : pending ? "Registrando…" : "Adicionar ao carrinho"}
    </button>
  );
}
