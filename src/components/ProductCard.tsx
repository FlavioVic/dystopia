import Image from "next/image";
import Link from "next/link";
import { AddToCartButton } from "@/components/AddToCartButton";
import { StarRating } from "@/components/StarRating";
import { gridCell } from "@/components/Kit";
import { WishlistHeart } from "@/components/WishlistHeart";
import { isLowStock } from "@/lib/catalog-rules";
import { discountPercent, formatPriceCents, installmentText } from "@/lib/format";
import { isTechnicalPlate } from "@/lib/product-media";

type ProductCardData = {
  id: string;
  slug: string;
  name: string;
  brand?: string | null;
  sku?: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  stockQuantity: number;
  ratingAverage: string | number;
  ratingCount: number;
  images: { url: string; altText: string | null }[];
  category?: { name: string } | null;
};

/**
 * Card do inventário. Mora numa grade com régua (`gridFrame` + `gridCell`):
 * a régua é a própria grade, sem sombra nem caixa arredondada.
 * Estado (desconto, estoque) é palavra num rótulo, nunca cor sozinha.
 */
export function ProductCard({ product, priority = false }: { product: ProductCardData; priority?: boolean }) {
  const discount = discountPercent(product.priceCents, product.compareAtPriceCents);
  const image = product.images[0];
  const outOfStock = product.stockQuantity <= 0;
  const lowStock = isLowStock(product.stockQuantity);
  const installment = installmentText(product.priceCents);

  return (
    <article className={`sweep group relative flex flex-col bg-background transition-colors hover:bg-background-elevated ${gridCell}`}>
      {/* Nome no próprio link: produto sem imagem deixaria um link vazio para o leitor de tela. */}
      <Link href={`/produto/${product.slug}`} aria-label={product.name} className="relative block aspect-square overflow-hidden">
        {image ? (
          <Image
            src={image.url}
            alt={image.altText ?? product.name}
            fill
            priority={priority}
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            // Foto (do catálogo ou do painel): inteira, com respiro. Placa técnica: preenche o quadro.
            className={
              isTechnicalPlate(image.url)
                ? "object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                : "object-contain p-5 transition-transform duration-500 group-hover:scale-[1.04]"
            }
          />
        ) : null}
        {/* No canto da foto só o que é curto: no celular o card tem ~179px, e
            "ÚLTIMAS 01" ao lado do "SALVAR" não cabe (um cobria o outro).
            Estoque fica junto do preço; esgotado, o próprio botão diz. */}
        {discount ? <span className="dys-label dys-label--classified absolute left-3 top-3">-{discount}%</span> : null}
      </Link>

      {/* Fora do <Link>: botão dentro de âncora não é HTML válido (e o clique navegaria). */}
      <div className="absolute right-3 top-3 z-10">
        <WishlistHeart productId={product.id} size="sm" />
      </div>

      <div className="flex flex-1 flex-col gap-2 border-t border-border-faint p-4">
        <span className="label truncate text-foreground-muted">
          {[product.brand, product.category?.name].filter(Boolean).join(" · ") || "Hardware"}
        </span>

        <Link href={`/produto/${product.slug}`}>
          <h3 className="line-clamp-2 min-h-10 text-sm leading-5 text-foreground group-hover:underline group-hover:underline-offset-4">
            {product.name}
          </h3>
        </Link>

        {product.ratingCount > 0 ? <StarRating rating={Number(product.ratingAverage)} count={product.ratingCount} /> : null}

        <div className="mt-1 flex flex-col gap-1">
          {product.compareAtPriceCents ? (
            <span className="font-mono text-xs text-foreground-muted line-through">
              {formatPriceCents(product.compareAtPriceCents)}
            </span>
          ) : null}
          <span className="font-mono text-xl font-semibold leading-none text-foreground">
            {formatPriceCents(product.priceCents)}
          </span>
          {installment ? <span className="text-xs text-foreground-muted">{installment}</span> : null}
          {lowStock ? (
            <span className="dys-label mt-1 self-start">Últimas {String(product.stockQuantity).padStart(2, "0")}</span>
          ) : null}
        </div>

        <div className="mt-auto pt-3">
          <AddToCartButton productId={product.id} disabled={outOfStock} />
        </div>
      </div>
    </article>
  );
}
