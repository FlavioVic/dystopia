import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ProductCard } from "@/components/ProductCard";
import { getCurrentUser } from "@/lib/data/auth";
import { getWishlist } from "@/lib/data/wishlist";

export const metadata: Metadata = { title: "Favoritos" };

export default async function WishlistPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/entrar");

  const items = await getWishlist();

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-brand text-2xl font-bold uppercase tracking-tight">Favoritos</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            {items.length === 0
              ? "Nada salvo ainda."
              : items.length === 1
                ? "1 produto salvo pra depois."
                : `${items.length} produtos salvos pra depois.`}
          </p>
        </div>
        <Link href="/conta" className="text-sm text-foreground-muted hover:text-foreground">
          ← Minha conta
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-border bg-background-elevated p-10 text-center">
          <p className="text-sm text-foreground-muted">
            Toque no ♡ dos produtos que você quer comprar depois — eles aparecem aqui.
          </p>
          <Link
            href="/produtos"
            className="mt-5 inline-block rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground"
          >
            Ver produtos
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <ProductCard
              key={item.productId}
              product={{
                id: item.product.id,
                slug: item.product.slug,
                name: item.product.name,
                priceCents: item.product.priceCents,
                compareAtPriceCents: item.product.compareAtPriceCents,
                stockQuantity: item.product.stockQuantity,
                ratingAverage: item.product.ratingAverage,
                ratingCount: item.product.ratingCount,
                images: item.product.images,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
