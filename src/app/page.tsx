import Image from "next/image";
import Link from "next/link";
import { ProductCard } from "@/components/ProductCard";
import { getCategories, getFeaturedProducts } from "@/lib/data/products";

export default async function Home() {
  const [featured, categories] = await Promise.all([
    getFeaturedProducts(8),
    getCategories(),
  ]);

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="hero-bg relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/45 via-black/10 to-transparent" />
        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-amber-bright">
            Bem-vindo à megacidade
          </span>
          <h1 className="mt-4 max-w-3xl font-brand text-4xl font-bold uppercase leading-[1.05] tracking-tight text-white sm:text-6xl">
            Cultura geek entre o analógico e o{" "}
            <span className="text-amber-bright">neon</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-white/85 sm:text-lg">
            Colecionáveis, quadrinhos, games e moda de um futuro cyberpunk
            fictício — feito por fãs, pra fãs.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/produtos"
              className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-bold text-[#1a1410] transition-transform hover:scale-[1.02]"
            >
              Ver ofertas
              <span aria-hidden>→</span>
            </Link>
            <Link
              href="#categorias"
              className="inline-flex items-center gap-2 rounded-lg border border-white/70 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              Explorar categorias
            </Link>
          </div>
        </div>
      </section>

      {/* Categorias */}
      {categories.length > 0 ? (
        <section id="categorias" className="mx-auto w-full max-w-7xl scroll-mt-20 px-4 py-14 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between">
            <h2 className="font-brand text-xl font-bold uppercase tracking-tight sm:text-2xl">
              Categorias
            </h2>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {categories.map((c) => (
              <Link
                key={c.slug}
                href={`/categoria/${c.slug}`}
                className="group relative flex aspect-[4/3] items-end overflow-hidden rounded-xl border border-border bg-background-elevated transition-all hover:-translate-y-0.5 hover:border-violet/40"
              >
                {c.imageUrl ? (
                  <Image
                    src={c.imageUrl}
                    alt={c.name}
                    fill
                    priority
                    sizes="(min-width: 1024px) 16vw, 33vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : null}
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
                <span className="relative p-3 text-sm font-semibold leading-tight text-white">
                  {c.name}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Destaques */}
      {featured.length > 0 ? (
        <section className="mx-auto w-full max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <span className="h-6 w-1.5 rounded-full bg-accent" aria-hidden />
              <h2 className="font-brand text-xl font-bold uppercase tracking-tight sm:text-2xl">
                Ofertas em destaque
              </h2>
            </div>
            <Link href="/produtos" className="shrink-0 text-sm font-medium text-accent hover:underline">
              ver tudo →
            </Link>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {featured.map((p, i) => (
              <ProductCard key={p.slug} product={p} priority={i < 4} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
