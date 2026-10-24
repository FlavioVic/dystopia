import type { Metadata } from "next";
import Link from "next/link";
import { ClassLabel, PageHeader, SectionHeading, gridCell, gridFrame } from "@/components/Kit";
import { ServiceRequestForm } from "@/components/ServiceRequestForm";
import { PROFILE } from "@/lib/portfolio";
import { PROCESS, SERVICES, isServiceKind } from "@/lib/services-catalog";

export const metadata: Metadata = {
  title: "Serviços",
  description:
    "Montagem, manutenção e formatação de computadores, e desenvolvimento de software, por Flávio Victor.",
};


export default async function ServicesPage(props: PageProps<"/servicos">) {
  const params = await props.searchParams;
  const raw = Array.isArray(params.servico) ? params.servico[0] : params.servico;
  const defaultKind = raw && isServiceKind(raw) ? raw : undefined;

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <PageHeader
        label="Serviços / Protocolo técnico"
        title="Intervenção técnica"
        description="Hardware montado, mantido e restaurado. Software construído sob medida. Cada intervenção é registrada do pedido à entrega."
        meta={<ClassLabel level="authorized">Executado por Flávio Victor</ClassLabel>}
      />

      <div className={`mt-12 grid-cols-1 lg:grid-cols-2 ${gridFrame}`}>
        {SERVICES.map((s) => (
          <section key={s.kind} id={s.kind} className={`flex min-w-0 scroll-mt-32 flex-col gap-5 p-6 sm:p-8 ${gridCell}`}>
            <div className="flex items-center justify-between gap-4">
              <span className="serial text-foreground-muted">{s.serial}</span>
              <Link
                href={`/servicos?servico=${s.kind}#orcamento`}
                className="label text-foreground underline-offset-4 hover:underline"
              >
                Solicitar
              </Link>
            </div>
            <h2 className="display-3 break-words text-[16px] leading-[24px] tracking-[0.08em] sm:text-[20px] sm:leading-[28px] sm:tracking-[0.1em]">
              {s.name}
            </h2>
            <p className="text-base leading-relaxed text-foreground-muted">{s.summary}</p>
            <ul className="mt-auto flex flex-col border-t border-border-faint">
              {s.scope.map((item, i) => (
                <li key={item} className="flex gap-4 border-b border-border-faint py-2.5 text-sm">
                  <span className="font-mono text-foreground-muted">{String(i + 1).padStart(2, "0")}</span>
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="mt-20">
        <SectionHeading index="04 etapas" label="Procedimento" title="Como funciona" />
        <ol className={`mt-8 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 ${gridFrame}`}>
          {PROCESS.map((p) => (
            <li key={p.step} className={`flex flex-col gap-3 p-6 ${gridCell}`}>
              <span className="font-mono text-3xl font-semibold text-foreground-muted">{p.step}</span>
              <span className="display-4 text-[13px]">{p.title}</span>
              <p className="text-sm leading-relaxed text-foreground-muted">{p.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="orcamento" className="mt-20 grid scroll-mt-32 gap-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <SectionHeading index="DYS-S" label="Orçamento" title="Registrar solicitação" />
          <p className="mt-6 text-base leading-relaxed text-foreground-muted">
            Descreva o equipamento ou o sistema, o problema e o prazo. O orçamento é enviado por escrito antes de
            qualquer intervenção.
          </p>
          <div className="mt-8 border-t border-border-faint pt-6">
            <p className="label text-foreground-muted">Responsável técnico</p>
            <p className="mt-2 text-lg font-semibold">{PROFILE.name}</p>
            <p className="label mt-1 text-signal-text">{PROFILE.role}</p>
            <p className="mt-3 text-sm leading-relaxed text-foreground-muted">{PROFILE.summary}</p>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              <Link href="/portfolio" className="label text-foreground underline underline-offset-4 hover:text-signal-text">
                Portfólio
              </Link>
              <a href={PROFILE.linkedin} target="_blank" rel="noreferrer" className="label text-foreground-muted hover:text-foreground">
                LinkedIn
              </a>
              <a href={PROFILE.github} target="_blank" rel="noreferrer" className="label text-foreground-muted hover:text-foreground">
                GitHub
              </a>
            </div>
          </div>
        </div>
        <div className="lg:col-span-7">
          <ServiceRequestForm defaultKind={defaultKind} />
        </div>
      </section>
    </div>
  );
}
