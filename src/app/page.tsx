import type { Metadata } from "next";
import Link from "next/link";
import { SectionHeading, Sector, buttonPrimary, buttonSecondary, gridCell, gridFrame } from "@/components/Kit";
import { EmblemSting } from "@/components/Logo";
import { Marquee } from "@/components/Marquee";
import { Reveal } from "@/components/Motion";
import { PortfolioCard, ProjectImage, StackTags } from "@/components/PortfolioCard";
import { ProductCard } from "@/components/ProductCard";
import { getFeaturedProducts } from "@/lib/data/products";
import { PORTFOLIO, PROFILE } from "@/lib/portfolio";
import { PROCESS, SERVICES, TICKER } from "@/lib/services-catalog";
import { canonical } from "@/lib/seo";

export const metadata: Metadata = { alternates: canonical("/") };

export default async function Home() {
  const featured = await getFeaturedProducts(4);
  const [lead, ...others] = PORTFOLIO;


  return (
    <div className="flex flex-col">
      {/* ---------------------------------------------------------- abertura */}
      {/* Em monitor grande (3xl, ≥1800px, junto com a largura do site) o hero ocupa a
          primeira tela e cresce, com o emblema sempre ao lado do texto. */}
      <section className="bg-grid relative flex overflow-hidden border-b border-border 3xl:min-h-[calc(100svh-9.25rem)] 3xl:items-center">
        <div className="mx-auto grid w-full max-w-site items-center gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-12 lg:px-8 lg:py-24">
          <div className="lg:col-span-7 3xl:col-span-8">
            <Reveal immediate>
              <p className="label text-foreground-muted 3xl:text-[13px]">
                <span className="text-signal-text">{PROFILE.name}</span> / Desenvolvimento e hardware
              </p>
            </Reveal>
            <Reveal immediate delay={80}>
              <h1 className="display-1 mt-6 3xl:text-[92px] 3xl:leading-[100px]">
                A ordem é um <span className="text-primary">serviço.</span>
                <span aria-hidden="true" className="caret ml-1 inline-block h-[0.8em] w-[0.35em] translate-y-[0.1em] bg-primary" />
              </h1>
            </Reveal>
            <Reveal immediate delay={160}>
              <p className="mt-6 max-w-xl text-lg leading-[28px] text-foreground-muted 3xl:mt-8 3xl:max-w-2xl 3xl:text-xl 3xl:leading-[32px]">
                Software construído sob medida. Computadores montados, mantidos e restaurados. Cada intervenção é
                registrada do pedido à entrega.
              </p>
            </Reveal>
            <Reveal immediate delay={240}>
              <div className="mt-10 flex flex-wrap gap-3">
                <Link href="/servicos#orcamento" className={buttonPrimary}>
                  Solicitar orçamento
                </Link>
                <Link href="/portfolio" className={buttonSecondary}>
                  Ver portfólio
                </Link>
              </div>
            </Reveal>
          </div>

          <div className="hidden lg:col-span-5 lg:flex lg:justify-end 3xl:col-span-4">
            <div className="dys-frame flex flex-col items-center gap-8 bg-background px-14 py-12">
              <EmblemSting size={248} className="text-primary 3xl:size-[340px]" title="Emblema DYSTOPIA" />
              <p className="serial text-foreground-muted">
                EMISSÃO OFICIAL / <span className="text-signal-text">DYS-0001</span>
              </p>
            </div>
          </div>
        </div>
      </section>

      <Marquee items={TICKER} />

      {/* ---------------------------------------------------------- serviços */}
      <Sector tone="crimson" id="servicos">
        <Reveal>
          <SectionHeading
            index="01 / 05"
            label="Serviços"
            title="Intervenção técnica"
            action={
              <Link href="/servicos" className="label shrink-0 text-signal-text hover:text-foreground">
                Todos os serviços
              </Link>
            }
          />
        </Reveal>
        <div className={`mt-8 grid-cols-1 md:grid-cols-2 ${gridFrame}`}>
          {SERVICES.map((s, i) => (
            <Reveal key={s.kind} delay={i * 90} className={`min-w-0 ${gridCell}`}>
              <Link
                href={`/servicos?servico=${s.kind}#orcamento`}
                className="sweep group flex h-full flex-col gap-5 bg-background p-6 transition-colors hover:bg-background-elevated sm:p-8"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="font-mono text-5xl font-semibold text-primary transition-transform duration-300 group-hover:-translate-y-1">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="serial text-foreground-muted">{s.serial}</span>
                </div>
                <h3 className="display-3 break-words text-[15px] leading-[24px] tracking-[0.06em] sm:text-[20px] sm:leading-[28px] sm:tracking-[0.1em]">{s.name}</h3>
                <p className="text-base leading-relaxed text-foreground-muted">{s.summary}</p>
                <ul className="flex flex-col gap-2">
                  {s.scope.slice(0, 3).map((item) => (
                    <li key={item} className="flex items-center gap-3 text-sm text-foreground">
                      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 bg-primary" />
                      {item}
                    </li>
                  ))}
                </ul>
                <span className="label mt-auto flex items-center gap-2 pt-2 text-signal-text">
                  Solicitar orçamento
                  <span aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-1">
                    →
                  </span>
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </Sector>

      {/* ---------------------------------------------------------- portfólio */}
      <Sector tone="graphite" id="portfolio">
        <Reveal>
          <SectionHeading
            index="02 / 05"
            label="Portfólio"
            title="Projetos entregues"
            action={
              <Link href="/portfolio" className="label shrink-0 text-signal-text hover:text-foreground">
                Portfólio completo
              </Link>
            }
          />
        </Reveal>

        <Reveal className="mt-8">
          <article className="sweep group grid gap-8 border border-border-faint bg-background p-5 transition-colors hover:bg-background-elevated sm:p-8 lg:grid-cols-12">
            <Link href={`/portfolio#${lead.slug}`} className="lg:col-span-7">
              <ProjectImage project={lead} priority sizes="(min-width: 1024px) 55vw, 90vw" />
            </Link>
            <div className="flex flex-col gap-5 lg:col-span-5">
              <div className="flex items-center justify-between">
                <span className="serial text-signal-text">{lead.code}</span>
                <span className="dys-label dys-label--restricted">Em destaque</span>
              </div>
              <h3 className="display-2 text-[26px] leading-[34px] sm:text-[32px] sm:leading-[40px]">{lead.name}</h3>
              <p className="label text-foreground-muted">{lead.kind}</p>
              <p className="text-base leading-relaxed text-foreground-muted">{lead.summary}</p>
              <ul className="flex flex-col gap-2">
                {lead.highlights.map((h) => (
                  <li key={h} className="flex gap-3 text-sm text-foreground">
                    <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 bg-primary" />
                    {h}
                  </li>
                ))}
              </ul>
              <StackTags stack={lead.stack} />
              <div className="mt-auto flex flex-wrap gap-3 pt-2">
                <Link href={`/portfolio#${lead.slug}`} className={buttonSecondary}>
                  Ver projeto
                </Link>
                <a href={lead.repo} target="_blank" rel="noreferrer" className="label self-center text-foreground-muted hover:text-foreground">
                  Código no GitHub
                </a>
              </div>
            </div>
          </article>
        </Reveal>

        <div className={`grid-cols-1 border-t-0 sm:grid-cols-2 ${gridFrame}`}>
          {others.slice(0, 4).map((p, i) => (
            <Reveal key={p.slug} delay={i * 90} className={gridCell}>
              <PortfolioCard project={p} />
            </Reveal>
          ))}
        </div>
      </Sector>

      {/* ---------------------------------------------------------- processo */}
      <Sector tone="bone">
        <Reveal>
          <SectionHeading index="03 / 05" label="Procedimento" title="Como funciona" />
        </Reveal>
        <ol className={`mt-8 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 ${gridFrame}`}>
          {PROCESS.map((p, i) => (
            <Reveal as="li" key={p.step} delay={i * 90} className={`relative flex flex-col gap-3 p-6 ${gridCell}`}>
              <span className="font-mono text-4xl font-semibold text-primary">{p.step}</span>
              <span className="display-4 text-[13px]">{p.title}</span>
              <p className="text-sm leading-relaxed text-foreground-muted">{p.text}</p>
            </Reveal>
          ))}
        </ol>
      </Sector>

      {/* ---------------------------------------------------------- loja */}
      {featured.length > 0 ? (
        <section className="mx-auto w-full max-w-site px-4 pt-24 sm:px-6 lg:px-8">
          <Reveal>
            <SectionHeading
              index="04 / 05"
              label="Loja"
              title="Hardware registrado"
              action={
                <Link href="/produtos" className="label shrink-0 text-signal-text hover:text-foreground">
                  Inventário completo
                </Link>
              }
            />
          </Reveal>
          <Reveal className="mt-8">
            <div className={`grid-cols-2 lg:grid-cols-4 ${gridFrame}`}>
              {featured.map((p) => (
                <ProductCard key={p.slug} product={p} />
              ))}
            </div>
          </Reveal>
        </section>
      ) : null}

      {/* ---------------------------------------------------------- chamado */}
      <section className="mt-24">
        <div className="hazard" aria-hidden="true" />
        <div className="bg-primary text-primary-foreground">
          <Reveal className="mx-auto flex max-w-site flex-col items-start gap-8 px-4 py-16 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:px-8">
            <div>
              <p className="label opacity-80">05 / 05 — Protocolo aberto</p>
              <h2 className="display-2 mt-4 text-[26px] leading-[34px] sm:text-[40px] sm:leading-[48px]">
                Registre sua solicitação.
              </h2>
              <p className="mt-4 max-w-xl text-base leading-relaxed opacity-90">
                Orçamento por escrito, sem custo. Nenhuma intervenção começa sem aprovação.
              </p>
            </div>
            <Link
              href="/servicos#orcamento"
              className="label inline-flex shrink-0 items-center gap-2 bg-bone px-6 py-4 text-obsidian transition-colors duration-150 hover:bg-obsidian hover:text-bone"
            >
              Solicitar orçamento
              <span aria-hidden="true">→</span>
            </Link>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
