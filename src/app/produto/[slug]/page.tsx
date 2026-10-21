import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductGallery } from "@/components/ProductGallery";
import { ProductActions } from "@/components/ProductActions";
import { ProductCard } from "@/components/ProductCard";
import { StarRating } from "@/components/StarRating";
import { CouponStrip } from "@/components/CouponStrip";
import { getActiveCoupons, getProductBySlug, getRelatedProducts } from "@/lib/data/products";

export async function generateMetadata(
  props: PageProps<"/produto/[slug]">,
): Promise<Metadata> {
  const { slug } = await props.params;
  const product = await getProductBySlug(slug);
  if (!product) return {};
  return {
    title: product.name,
    description: product.description.slice(0, 155),
  };
}

export default async function ProductPage(props: PageProps<"/produto/[slug]">) {
  const { slug } = await props.params;
  const product = await getProductBySlug(slug);

  if (!product) notFound();

  const [related, coupons] = await Promise.all([
    getRelatedProducts(product.categoryId, product.id, 4),
    getActiveCoupons(),
  ]);
  const rating = Number(product.ratingAverage);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <nav className="mb-6 text-xs text-foreground-muted">
        <Link href="/" className="hover:text-foreground">
          Início
        </Link>
        <span className="mx-1.5">/</span>
        <Link href={`/categoria/${product.category.slug}`} className="hover:text-foreground">
          {product.category.name}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-foreground">{product.name}</span>
      </nav>

      <div className="grid gap-10 lg:grid-cols-2">
        <ProductGallery images={product.images} productName={product.name} />

        <div className="flex flex-col gap-5">
          <div>
            {product.brand ? (
              <span className="text-xs font-medium uppercase tracking-wider text-foreground-muted">
                {product.brand}
              </span>
            ) : null}
            <h1 className="mt-1 text-2xl font-bold tracking-tight">{product.name}</h1>
            {product.ratingCount > 0 ? (
              <div className="mt-2">
                <StarRating rating={rating} count={product.ratingCount} size="md" />
              </div>
            ) : null}
          </div>

          <ProductActions
            productId={product.id}
            basePriceCents={product.priceCents}
            compareAtPriceCents={product.compareAtPriceCents}
            baseStock={product.stockQuantity}
            variants={product.variants.map((v) => ({
              id: v.id,
              name: v.name,
              priceCents: v.priceCents,
              stockQuantity: v.stockQuantity,
              attributes: v.attributes as Record<string, string>,
            }))}
          />

          <div className="border-t border-border pt-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
              Descrição
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-foreground">{product.description}</p>
          </div>
        </div>
      </div>

      <CouponStrip coupons={coupons} />

      {product.reviews.length > 0 ? (
        <section className="mt-16 border-t border-border pt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">
            Avaliações
          </h2>
          <div className="mt-5 flex flex-col gap-5 sm:grid sm:grid-cols-2 sm:gap-6">
            {product.reviews.map((r) => (
              <div key={r.id} className="rounded-lg border border-border bg-background-elevated p-4">
                <StarRating rating={r.rating} />
                {r.title ? <p className="mt-2 text-sm font-medium">{r.title}</p> : null}
                {r.comment ? (
                  <p className="mt-1 text-sm leading-relaxed text-foreground-muted">{r.comment}</p>
                ) : null}
                <p className="mt-3 text-xs text-foreground-muted">
                  {r.user.name}
                  {r.isVerifiedPurchase ? " · compra verificada" : ""}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {related.length > 0 ? (
        <section className="mt-16 border-t border-border pt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">
            Você também pode gostar
          </h2>
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {related.map((p) => (
              <ProductCard key={p.slug} product={p} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
