import Image from "next/image";
import Link from "next/link";
import { StarRating } from "@/components/StarRating";
import { AddToCartButton } from "@/components/AddToCartButton";
import { WishlistHeart } from "@/components/WishlistHeart";
import {
  discountPercent,
  formatPriceCents,
  installmentText,
  isFreeShipping,
} from "@/lib/format";

type ProductCardData = {
  id: string;
  slug: string;
  name: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  stockQuantity: number;
  ratingAverage: string | number;
  ratingCount: number;
  images: { url: string; altText: string | null }[];
  category?: { name: string } | null;
};

export function ProductCard({
  product,
  priority = false,
}: {
  product: ProductCardData;
  priority?: boolean;
}) {
  const discount = discountPercent(product.priceCents, product.compareAtPriceCents);
  const image = product.images[0];
  const rating = Number(product.ratingAverage);
  const outOfStock = product.stockQuantity <= 0;
  const lowStock = !outOfStock && product.stockQuantity <= 3;
  const freeShip = isFreeShipping(product.priceCents);
  const installment = installmentText(product.priceCents);

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-background-elevated transition-all duration-200 hover:-translate-y-0.5 hover:border-border-hover hover:shadow-[0_16px_36px_-20px_rgba(124,58,237,0.45)]">
      <Link
        href={`/produto/${product.slug}`}
        className="relative block aspect-square overflow-hidden bg-background"
      >
        {image ? (
          <Image
            src={image.url}
            alt={image.altText ?? product.name}
            fill
            priority={priority}
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : null}

        <div className="absolute left-2 top-2 flex flex-col items-start gap-1.5">
          {discount ? (
            <span className="rounded-md bg-deal px-2 py-0.5 text-[11px] font-bold text-deal-foreground shadow-sm">
              -{discount}%
            </span>
          ) : null}
          {outOfStock ? (
            <span className="rounded-md bg-danger px-2 py-0.5 text-[11px] font-bold text-white shadow-sm">
              Esgotado
            </span>
          ) : lowStock ? (
            <span className="rounded-md bg-amber-bright px-2 py-0.5 text-[11px] font-bold text-[#1a1410] shadow-sm">
              Últimas unidades
            </span>
          ) : null}
        </div>
      </Link>

      {/* Fora do <Link>: botão dentro de âncora não é HTML válido (e o clique navegaria). */}
      <div className="absolute right-2 top-2 z-10">
        <WishlistHeart productId={product.id} size="sm" />
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3.5">
        {product.category ? (
          <span className="text-[11px] font-semibold uppercase tracking-wider text-violet">
            {product.category.name}
          </span>
        ) : null}

        <Link href={`/produto/${product.slug}`}>
          <h3 className="line-clamp-2 text-sm font-medium text-foreground transition-colors group-hover:text-accent">
            {product.name}
          </h3>
        </Link>

        {product.ratingCount > 0 ? (
          <StarRating rating={rating} count={product.ratingCount} />
        ) : null}

        <div className="mt-1.5 flex flex-col gap-0.5">
          {product.compareAtPriceCents ? (
            <span className="font-mono text-xs text-foreground-muted line-through">
              {formatPriceCents(product.compareAtPriceCents)}
            </span>
          ) : null}
          <span className="font-mono text-lg font-bold leading-none text-accent">
            {formatPriceCents(product.priceCents)}
          </span>
          {installment ? (
            <span className="text-[11px] text-foreground-muted">{installment}</span>
          ) : null}
        </div>

        {freeShip ? (
          <span className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-full bg-deal-soft px-2 py-0.5 text-[11px] font-semibold text-success">
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 7h10v8H3zM13 10h4l3 3v2h-7z" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="7" cy="17" r="1.6" />
              <circle cx="17" cy="17" r="1.6" />
            </svg>
            Frete grátis
          </span>
        ) : null}

        <div className="mt-auto pt-3">
          <AddToCartButton productId={product.id} disabled={outOfStock} />
        </div>
      </div>
    </article>
  );
}
