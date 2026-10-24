"use client";

import Image from "next/image";
import Link from "next/link";
import { useTransition } from "react";
import type { CartLine } from "@/lib/data/cart";
import { removeCartItem, updateCartItemQuantity } from "@/lib/actions/cart";
import { formatPriceCents } from "@/lib/format";

export function CartItemRow({ line }: { line: CartLine }) {
  const [isPending, startTransition] = useTransition();

  function setQuantity(next: number) {
    startTransition(async () => {
      await updateCartItemQuantity(line.itemId, next);
    });
  }

  function remove() {
    startTransition(async () => {
      await removeCartItem(line.itemId);
    });
  }

  const atMax = line.quantity >= Math.min(line.stock, 10);

  return (
    <li
      className={`flex gap-4 py-5 transition-opacity ${isPending ? "opacity-50" : ""}`}
    >
      <Link
        href={`/produto/${line.slug}`}
        className="relative aspect-square h-20 w-20 shrink-0 overflow-hidden rounded-md border border-border bg-background"
      >
        {line.imageUrl ? (
          <Image
            src={line.imageUrl}
            alt={line.imageAlt ?? line.name}
            fill
            sizes="80px"
            className="object-cover"
          />
        ) : null}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              href={`/produto/${line.slug}`}
              className="line-clamp-2 text-sm font-medium hover:text-accent"
            >
              {line.name}
            </Link>
            {line.variantName ? (
              <p className="mt-0.5 text-xs text-foreground-muted">{line.variantName}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={remove}
            disabled={isPending}
            className="shrink-0 text-xs text-foreground-muted transition-colors hover:text-foreground disabled:opacity-40"
          >
            Remover
          </button>
        </div>

        <div className="mt-auto flex items-end justify-between gap-3 pt-3">
          <div className="flex items-center rounded-md border border-border">
            <button
              type="button"
              onClick={() => setQuantity(line.quantity - 1)}
              disabled={isPending}
              className="flex h-8 w-8 items-center justify-center text-foreground-muted transition-colors hover:text-foreground disabled:opacity-40"
              aria-label="Diminuir quantidade"
            >
              −
            </button>
            <span className="w-8 text-center text-sm tabular-nums">{line.quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity(line.quantity + 1)}
              disabled={isPending || atMax}
              className="flex h-8 w-8 items-center justify-center text-foreground-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Aumentar quantidade"
            >
              +
            </button>
          </div>

          <div className="text-right">
            <span className="font-mono text-sm font-semibold">
              {formatPriceCents(line.lineTotalCents)}
            </span>
            {line.quantity > 1 ? (
              <span className="block text-[11px] text-foreground-muted">
                {formatPriceCents(line.unitPriceCents)} cada
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}
