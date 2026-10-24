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

  const dimension = size === "sm" ? "px-2 py-1" : "px-3 py-2";

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
      className={`label border ${dimension} disabled:opacity-60 ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-foreground-muted hover:border-foreground hover:text-foreground"
      }`}
    >
      {active ? "Salvo" : "Salvar"}
    </button>
  );
}
