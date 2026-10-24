import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, ProductGrid, Sector, counted } from "@/components/Kit";
import { Pagination } from "@/components/Pagination";
import { ProductCard } from "@/components/ProductCard";
import { getCategoryBySlug, getProductsByCategorySlug } from "@/lib/data/products";
import { isPastLastPage, parsePage, STORE_PAGE_SIZE } from "@/lib/pagination";

export async function generateMetadata(props: PageProps<"/categoria/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const category = await getCategoryBySlug(slug);
  if (!category) return {};
  return { title: category.name, description: category.description ?? undefined };
}

export default async function CategoryPage(props: PageProps<"/categoria/[slug]">) {
  const { slug } = await props.params;
  const page = parsePage((await props.searchParams).pagina, STORE_PAGE_SIZE);
  const { category, products, total } = await getProductsByCategorySlug(slug, page);

  if (!category || isPastLastPage(page.page, total, STORE_PAGE_SIZE)) notFound();

  return (
    <>
      <Sector tone="crimson" compact>
        <PageHeader
          ruled={false}
          label="Inventário / Categoria"
          title={category.name}
          description={category.description ?? undefined}
          meta={counted(total, "item registrado", "itens registrados")}
        />
      </Sector>

      <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
        {products.length > 0 ? (
          <ProductGrid>
            {products.map((p, i) => (
              <ProductCard key={p.slug} product={{ ...p, category }} priority={i < 4} />
            ))}
          </ProductGrid>
        ) : (
          <p className="mt-12 text-base text-foreground-muted">Nenhum item registrado nesta categoria.</p>
        )}
        <Pagination basePath={`/categoria/${category.slug}`} page={page.page} total={total} pageSize={STORE_PAGE_SIZE} />
      </div>
    </>
  );
}
