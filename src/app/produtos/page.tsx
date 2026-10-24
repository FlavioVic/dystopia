import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, ProductGrid, Sector, buttonPrimary, counted } from "@/components/Kit";
import { Pagination } from "@/components/Pagination";
import { ProductCard } from "@/components/ProductCard";
import { listActiveProducts, searchProducts } from "@/lib/data/products";
import { isPastLastPage, parsePage, STORE_PAGE_SIZE } from "@/lib/pagination";

export const metadata: Metadata = {
  title: "Inventário",
  description:
    "Peças de PC com ficha técnica: placas de vídeo, processadores, placas-mãe, memória, SSD, fontes, gabinetes, refrigeração, monitores e periféricos.",
};

export default async function ProductsPage(props: PageProps<"/produtos">) {
  const params = await props.searchParams;
  const raw = params.q;
  const query = (Array.isArray(raw) ? raw[0] : raw ?? "").trim();

  const page = parsePage(params.pagina, STORE_PAGE_SIZE);
  const { items: products, total } = query ? await searchProducts(query, page) : await listActiveProducts(page);
  if (isPastLastPage(page.page, total, STORE_PAGE_SIZE)) notFound();

  return (
    <>
      <Sector tone="crimson" compact>
        <PageHeader
          ruled={false}
          label={query ? "Consulta ao inventário" : "Inventário completo"}
          title={query ? "Resultado da consulta" : "Inventário"}
          description={
            query ? (
              <>
                Termo consultado: <span className="text-foreground">“{query}”</span>.{" "}
                <Link href="/produtos" className="underline underline-offset-4 hover:text-foreground">
                  Encerrar consulta
                </Link>
                .
              </>
            ) : (
              "Todo o hardware registrado. Disponibilidade sujeita a estoque."
            )
          }
          meta={counted(total, "item registrado", "itens registrados")}
        />
      </Sector>

      <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
        {products.length === 0 ? (
          <div className="mt-16 flex flex-col items-start gap-6">
            <p className="text-base text-foreground-muted">Nenhum registro corresponde a “{query}”.</p>
            <Link href="/produtos" className={buttonPrimary}>
              Consultar inventário completo
            </Link>
          </div>
        ) : (
          <ProductGrid>
            {products.map((p, i) => (
              <ProductCard key={p.slug} product={p} priority={i < 4} />
            ))}
          </ProductGrid>
        )}
        <Pagination
          basePath="/produtos"
          page={page.page}
          total={total}
          pageSize={STORE_PAGE_SIZE}
          params={query ? { q: query } : {}}
        />
      </div>
    </>
  );
}
