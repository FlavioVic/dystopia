import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/ProductCard";
import { getProductsByCategorySlug } from "@/lib/data/products";

export async function generateMetadata(
  props: PageProps<"/categoria/[slug]">,
): Promise<Metadata> {
  const { slug } = await props.params;
  const { category } = await getProductsByCategorySlug(slug);
  if (!category) return {};
  return { title: category.name, description: category.description ?? undefined };
}

export default async function CategoryPage(props: PageProps<"/categoria/[slug]">) {
  const { slug } = await props.params;
  const { category, products } = await getProductsByCategorySlug(slug);

  if (!category) notFound();

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="border-b border-border pb-6">
        <h1 className="text-2xl font-bold tracking-tight">{category.name}</h1>
        {category.description ? (
          <p className="mt-2 max-w-xl text-sm text-foreground-muted">{category.description}</p>
        ) : null}
        <p className="mt-2 text-xs text-foreground-muted">
          {products.length} produto{products.length === 1 ? "" : "s"}
        </p>
      </div>

      {products.length > 0 ? (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((p, i) => (
            <ProductCard key={p.slug} product={p} priority={i < 4} />
          ))}
        </div>
      ) : (
        <p className="mt-10 text-sm text-foreground-muted">
          Nenhum produto nessa categoria ainda.
        </p>
      )}
    </div>
  );
}
