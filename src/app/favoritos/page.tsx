import type { Metadata } from "next";
import Link from "next/link";
import { ProductGrid, buttonCompact, buttonPrimary } from "@/components/Kit";
import { redirect } from "next/navigation";
import { ProductCard } from "@/components/ProductCard";
import { getCurrentUser } from "@/lib/data/auth";
import { getWishlist } from "@/lib/data/wishlist";
import { PRIVATE_PAGE } from "@/lib/seo";

export const metadata: Metadata = { title: "Arquivo de favoritos", robots: PRIVATE_PAGE };

export default async function WishlistPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/entrar");

  const items = await getWishlist();

  return (
    <div className="mx-auto max-w-site px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display-2 text-[26px] leading-[34px] sm:text-[32px] sm:leading-[40px]">Arquivo</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            {items.length === 0
              ? "Nenhum item arquivado."
              : `${String(items.length).padStart(2, "0")} ${items.length === 1 ? "item arquivado" : "itens arquivados"}.`}
          </p>
        </div>
        <Link href="/conta" className={buttonCompact}>
          <span aria-hidden="true">←</span> Voltar à ficha
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="mt-10 flex flex-col items-start gap-5 border-t border-border-faint pt-10">
          <p className="text-base text-foreground-muted">
            Use &ldquo;Salvar&rdquo; em qualquer item do inventário. Ele fica arquivado aqui.
          </p>
          <Link href="/produtos" className={buttonPrimary}>
            Consultar inventário
          </Link>
        </div>
      ) : (
        <ProductGrid>
          {items.map((item) => (
            <ProductCard
              key={item.productId}
              product={{
                id: item.product.id,
                slug: item.product.slug,
                name: item.product.name,
                brand: item.product.brand,
                priceCents: item.product.priceCents,
                compareAtPriceCents: item.product.compareAtPriceCents,
                stockQuantity: item.product.stockQuantity,
                ratingAverage: item.product.ratingAverage,
                ratingCount: item.product.ratingCount,
                images: item.product.images,
              }}
            />
          ))}
        </ProductGrid>
      )}
    </div>
  );
}
