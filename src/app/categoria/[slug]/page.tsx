import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, ProductGrid, counted } from "@/components/Kit";
import { ProductCard } from "@/components/ProductCard";
import { getProductsByCategorySlug } from "@/lib/data/products";

export async function generateMetadata(props: PageProps<"/categoria/[slug]">): Promise<Metadata> {
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
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <PageHeader
        label="Inventário / Categoria"
        title={category.name}
        description={category.description ?? undefined}
        meta={counted(products.length, "item registrado", "itens registrados")}
      />

      {products.length > 0 ? (
        <ProductGrid>
          {products.map((p, i) => (
            <ProductCard key={p.slug} product={{ ...p, category }} priority={i < 4} />
          ))}
        </ProductGrid>
      ) : (
        <p className="mt-12 text-base text-foreground-muted">Nenhum item registrado nesta categoria.</p>
      )}
    </div>
  );
}
