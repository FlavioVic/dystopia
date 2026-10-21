"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toggleWishlistItem } from "@/lib/actions/wishlist";

/**
 * Coração de favoritar. Atualiza na hora (otimista) e volta atrás se o
 * servidor recusar; visitante não logado é mandado pro /entrar.
 */
export function WishlistToggle({
  productId,
  initial,
  isLoggedIn,
  size = "md",
}: {
  productId: string;
  initial: boolean;
  isLoggedIn: boolean;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [active, setActive] = useState(initial);
  const [pending, startTransition] = useTransition();

  const dimension = size === "sm" ? "h-8 w-8 text-sm" : "h-9 w-9 text-base";

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={active}
      aria-label={active ? "Remover dos favoritos" : "Adicionar aos favoritos"}
      title={active ? "Remover dos favoritos" : "Adicionar aos favoritos"}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();

        if (!isLoggedIn) {
          router.push("/entrar");
          return;
        }

        const next = !active;
        setActive(next);
        startTransition(async () => {
          const result = await toggleWishlistItem(productId);
          if (!result.ok) {
            setActive(!next);
            if (result.requiresAuth) router.push("/entrar");
            return;
          }
          setActive(result.inWishlist ?? next);
        });
      }}
      className={`flex ${dimension} items-center justify-center rounded-full border backdrop-blur transition-colors disabled:opacity-60 ${
        active
          ? "border-accent/40 bg-accent/15 text-accent"
          : "border-border bg-background/80 text-foreground-muted hover:border-accent/40 hover:text-accent"
      }`}
    >
      {active ? "♥" : "♡"}
    </button>
  );
}
