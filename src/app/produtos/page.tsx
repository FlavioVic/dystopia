import type { Metadata } from "next";
import Link from "next/link";
import { ProductCard } from "@/components/ProductCard";
import { getAllProducts, searchProducts } from "@/lib/data/products";

export const metadata: Metadata = {
  title: "Todos os produtos",
};

export default async function ProductsPage(props: PageProps<"/produtos">) {
  const params = await props.searchParams;
  const raw = params.q;
  const query = (Array.isArray(raw) ? raw[0] : raw ?? "").trim();

  const products = query ? await searchProducts(query) : await getAllProducts();

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="border-b border-border pb-6">
        <h1 className="font-brand text-2xl font-bold uppercase tracking-tight">
          {query ? "Resultados" : "Todos os produtos"}
        </h1>
        <p className="mt-2 text-sm text-foreground-muted">
          {query ? (
            <>
              {products.length} resultado{products.length === 1 ? "" : "s"} para{" "}
              <span className="font-medium text-foreground">“{query}”</span> ·{" "}
              <Link href="/produtos" className="text-accent hover:underline">
                limpar
              </Link>
            </>
          ) : (
            <>
              {products.length} produto{products.length === 1 ? "" : "s"}
            </>
          )}
        </p>
      </div>

      {products.length === 0 ? (
        <div className="mt-16 text-center">
          <p className="text-sm text-foreground-muted">
            Nenhum produto encontrado para “{query}”.
          </p>
          <Link
            href="/produtos"
            className="mt-4 inline-block rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground"
          >
            Ver todos os produtos
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((p, i) => (
            <ProductCard key={p.slug} product={p} priority={i < 4} />
          ))}
        </div>
      )}
    </div>
  );
}
