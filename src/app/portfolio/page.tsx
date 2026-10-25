import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Sector, buttonPrimary, buttonSecondary } from "@/components/Kit";
import { Reveal } from "@/components/Motion";
import { ProjectImage, StackTags } from "@/components/PortfolioCard";
import { PORTFOLIO, PROFILE } from "@/lib/portfolio";
import { canonical } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Portfólio",
  description: "Projetos de Flávio Victor: e-commerce com SAGA, SaaS de links, BI com IA, laboratório de segurança e mais.",
  alternates: canonical("/portfolio"),
};

export default function PortfolioPage() {
  return (
    <>
      <div className="mx-auto max-w-7xl px-4 pt-12 sm:px-6 lg:px-8">
        <PageHeader
          label="Portfólio / Arquivo de projetos"
          title="Projetos entregues"
          description={`${PROFILE.role}. ${PROFILE.summary}`}
          meta={
            <span className="flex flex-wrap gap-x-6 gap-y-2">
              <span>
                <span className="text-signal-text">{String(PORTFOLIO.length).padStart(2, "0")}</span> projetos públicos
              </span>
              <a href={PROFILE.github} target="_blank" rel="noreferrer" className="hover:text-foreground">
                GitHub
              </a>
              <a href={PROFILE.linkedin} target="_blank" rel="noreferrer" className="hover:text-foreground">
                LinkedIn
              </a>
            </span>
          }
        />
      </div>

      <ol className="mt-12">
        {PORTFOLIO.map((p, i) => (
          <li
            key={p.slug}
            id={p.slug}
            // Faixas alternadas: cada projeto é um setor, não um bloco no mesmo preto.
            className={`scroll-mt-16 ${i % 2 === 1 ? "sector-graphite border-y border-border-faint" : "border-b border-border-faint"}`}
          >
            <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
              <Reveal className="group grid items-start gap-10 lg:grid-cols-12">
                <div className={`min-w-0 lg:col-span-7 ${i % 2 === 1 ? "lg:order-2" : ""}`}>
                  <a href={p.live ?? p.repo} target="_blank" rel="noreferrer" aria-label={`Abrir ${p.name}`}>
                    <ProjectImage project={p} priority={i === 0} sizes="(min-width: 1024px) 55vw, 90vw" />
                  </a>
                </div>
                <div className={`flex min-w-0 flex-col gap-5 lg:col-span-5 ${i % 2 === 1 ? "lg:order-1" : ""}`}>
                  <div className="flex items-center justify-between gap-4">
                    <span className="serial text-signal-text">{p.code}</span>
                    <span className="label text-foreground-muted">
                      {p.year} / {p.kind}
                    </span>
                  </div>
                  <h2 className="display-2 break-words text-[26px] leading-[34px] sm:text-[36px] sm:leading-[44px]">{p.name}</h2>
                  <p className="text-base leading-relaxed text-foreground-muted">{p.summary}</p>
                  <ul className="flex flex-col gap-2 border-t border-border-faint pt-5">
                    {p.highlights.map((h) => (
                      <li key={h} className="flex gap-3 text-sm text-foreground">
                        <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 bg-primary" />
                        {h}
                      </li>
                    ))}
                  </ul>
                  <StackTags stack={p.stack} />
                  <div className="flex flex-wrap gap-3 pt-2">
                    {p.live ? (
                      <a href={p.live} target="_blank" rel="noreferrer" className={buttonPrimary}>
                        Ver no ar
                      </a>
                    ) : null}
                    <a href={p.repo} target="_blank" rel="noreferrer" className={buttonSecondary}>
                      Código no GitHub
                    </a>
                  </div>
                </div>
              </Reveal>
            </div>
          </li>
        ))}
      </ol>

      <Sector tone="crimson">
        <Reveal className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="label text-signal-text">Próximo projeto</p>
            <p className="display-3 mt-3 text-[20px] leading-[28px]">O seu.</p>
            <p className="mt-2 max-w-lg text-sm text-foreground-muted">
              Sistema web, loja, API ou automação. O escopo é definido antes da primeira linha de código.
            </p>
          </div>
          <Link href="/servicos?servico=desenvolvimento#orcamento" className={buttonPrimary}>
            Solicitar orçamento
          </Link>
        </Reveal>
      </Sector>
    </>
  );
}
