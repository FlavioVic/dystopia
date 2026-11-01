import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CouponStrip } from "@/components/CouponStrip";
import { ProductGrid, Rule, SectionHeading, Sector } from "@/components/Kit";
import { ProductActions } from "@/components/ProductActions";
import { ProductCard } from "@/components/ProductCard";
import { ProductGallery } from "@/components/ProductGallery";
import { ReviewForm } from "@/components/ReviewForm";
import { StarRating } from "@/components/StarRating";
import { WishlistHeart } from "@/components/WishlistHeart";
import { getOwnReview, getRatingBreakdown } from "@/lib/data/account";
import { getCurrentUser } from "@/lib/data/auth";
import { getActiveCoupons, getProductBySlug, getRelatedProducts } from "@/lib/data/products";
import { publicName } from "@/lib/format";
import { photoCreditByUrl } from "@/lib/photo-credits";
import { JsonLd, absoluteUrl, breadcrumb, canonical } from "@/lib/seo";

export async function generateMetadata(props: PageProps<"/produto/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const product = await getProductBySlug(slug);
  if (!product) return {};
  const photo = product.images.find((image) => image.url.endsWith(".webp"));
  return {
    title: product.name,
    description: product.description.slice(0, 155),
    alternates: canonical(`/produto/${product.slug}`),
    openGraph: photo ? { images: [{ url: photo.url, alt: photo.altText ?? product.name }] } : undefined,
  };
}

export default async function ProductPage(props: PageProps<"/produto/[slug]">) {
  const { slug } = await props.params;
  const product = await getProductBySlug(slug);

  if (!product) notFound();

  const [related, coupons, user, breakdown] = await Promise.all([
    getRelatedProducts(product.categoryId, product.id, 4),
    getActiveCoupons(),
    getCurrentUser(),
    getRatingBreakdown(product.id),
  ]);
  const ownReview = user ? await getOwnReview(user.id, product.id) : null;
  const rating = Number(product.ratingAverage);

  return (
    <>
      <JsonLd
        data={{
          "@graph": [
            {
              // Sem `offers`: a loja é demonstração (ver lib/seo.tsx).
              "@type": "Product",
              name: product.name,
              description: product.description,
              sku: product.sku,
              category: product.category.name,
              image: product.images.map((image) => absoluteUrl(image.url)),
              ...(product.brand ? { brand: { "@type": "Brand", name: product.brand } } : {}),
              ...(product.specs.length > 0
                ? {
                    additionalProperty: product.specs.map((spec) => ({
                      "@type": "PropertyValue",
                      name: spec.label,
                      value: spec.value,
                    })),
                  }
                : {}),
            },
            breadcrumb([
              { name: "Inventário", path: "/produtos" },
              { name: product.category.name, path: `/categoria/${product.category.slug}` },
              { name: product.name, path: `/produto/${product.slug}` },
            ]),
          ],
        }}
      />
      <div className="mx-auto max-w-site px-4 pb-16 pt-10 sm:px-6 lg:px-8">
        <nav aria-label="Trilha" className="label flex flex-wrap gap-2 text-foreground-muted">
          <Link href="/produtos" className="hover:text-foreground">
            Inventário
          </Link>
          <span aria-hidden="true">/</span>
          <Link href={`/categoria/${product.category.slug}`} className="hover:text-foreground">
            {product.category.name}
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-foreground">{product.sku}</span>
        </nav>

        <div className="mt-8 grid gap-10 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-7">
            <ProductGallery
              images={product.images.map((image) => ({ ...image, credit: photoCreditByUrl(image.url) }))}
              productName={product.name}
            />
          </div>

          <div className="flex flex-col gap-6 lg:col-span-5">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <span className="serial text-foreground-muted">
                  {product.sku}
                  {product.brand ? ` / ${product.brand.toUpperCase()}` : ""}
                </span>
                <WishlistHeart productId={product.id} />
              </div>
              <h1 className="text-[28px] font-semibold leading-[34px] tracking-[-0.005em]">{product.name}</h1>
              {product.ratingCount > 0 ? <StarRating rating={rating} count={product.ratingCount} size="md" /> : null}
              <p className="text-base leading-relaxed text-foreground-muted">{product.description}</p>
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

            <CouponStrip coupons={coupons} />
          </div>
        </div>
      </div>

      {product.specs.length > 0 ? (
        // Ficha técnica em bone: lê como a folha de especificação impressa.
        <Sector tone="bone">
          <SectionHeading index={product.sku} label="Ficha técnica" title="Especificações" />
          <dl className="mt-6 border-t border-border-faint">
            {product.specs.map((spec) => (
              <div
                key={spec.label}
                className="grid grid-cols-1 gap-1 border-b border-border-faint py-3 sm:grid-cols-12 sm:gap-6"
              >
                <dt className="label text-foreground-muted sm:col-span-4 sm:self-center">{spec.label}</dt>
                <dd className="font-mono text-sm text-foreground sm:col-span-8">{spec.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-foreground-muted">
            Especificações do fabricante. Preço fictício: projeto de portfólio.
          </p>
        </Sector>
      ) : null}

      <Sector tone="graphite">
        <SectionHeading index={`${String(product.ratingCount).padStart(2, "0")} registros`} label="Avaliações" title="Relatórios de campo" />

        <div className="mt-8 grid gap-8 lg:grid-cols-12">
          <div className="flex flex-col gap-6 lg:col-span-4">
            <div className="border border-border-faint p-5">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-4xl font-semibold">
                  {product.ratingCount > 0 ? rating.toFixed(1) : "—"}
                </span>
                <span className="label text-foreground-muted">de 5</span>
              </div>
              <div className="mt-3">
                <StarRating rating={rating} />
              </div>

              {product.ratingCount > 0 ? (
                <ul className="mt-5 flex flex-col gap-2">
                  {[5, 4, 3, 2, 1].map((star) => {
                    const total = breakdown[star] ?? 0;
                    const percent = product.ratingCount > 0 ? (total / product.ratingCount) * 100 : 0;
                    return (
                      <li key={star} className="flex items-center gap-3 font-mono text-xs text-foreground-muted">
                        <span className="w-4">{star}</span>
                        <span className="h-1 flex-1 bg-border-faint">
                          <span className="block h-full bg-foreground" style={{ width: `${percent}%` }} />
                        </span>
                        <span className="w-5 text-right">{String(total).padStart(2, "0")}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>

            <ReviewForm
              productId={product.id}
              isLoggedIn={user != null}
              own={ownReview ? { rating: ownReview.rating, title: ownReview.title, comment: ownReview.comment } : null}
            />
          </div>

          <div className="lg:col-span-8">
            {product.reviews.length > 0 ? (
              <ul className="flex flex-col">
                {product.reviews.map((r) => (
                  <li key={r.id} className="border-b border-border-faint py-5 first:pt-0">
                    <div className="flex items-center justify-between gap-4">
                      <StarRating rating={r.rating} />
                      <span className="label text-foreground-muted">
                        {publicName(r.user.name)}
                        {r.isVerifiedPurchase ? " · aquisição verificada" : ""}
                      </span>
                    </div>
                    {r.title ? <p className="mt-3 text-base font-semibold">{r.title}</p> : null}
                    {r.comment ? <p className="mt-1 text-sm leading-relaxed text-foreground-muted">{r.comment}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-base text-foreground-muted">Nenhum relatório registrado para este item.</p>
            )}
          </div>
        </div>
      </Sector>

      {related.length > 0 ? (
        <section className="mx-auto max-w-site px-4 py-16 sm:px-6 lg:px-8">
          <Rule label="Mesma categoria" index={product.category.name} />
          <ProductGrid>
            {related.map((p) => (
              <ProductCard key={p.slug} product={{ ...p, category: product.category }} />
            ))}
          </ProductGrid>
        </section>
      ) : null}
    </>
  );
}
