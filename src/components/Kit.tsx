import type { ReactNode } from "react";

/**
 * Kit da linguagem gráfica (design system DYSTOPIA). Cada peça tem um
 * trabalho; use só pra ele:
 * - Rule: divide e indexa ("02 / 04").
 * - SectionHeading: abre uma seção (índice + título display).
 * - ClassLabel: declara acesso/estado por PALAVRA. Só `restricted` é vermelho,
 *   e no máximo um por tela.
 */

export function Rule({ label, index, className = "" }: { label?: string; index?: string; className?: string }) {
  return (
    <div className={`label flex items-center gap-3 text-foreground-muted ${className}`}>
      {label ? <span className="shrink-0">{label}</span> : null}
      <span className="relative h-px flex-1 bg-border before:absolute before:-top-1 before:left-0 before:h-[9px] before:w-px before:bg-border after:absolute after:-top-1 after:right-0 after:h-[9px] after:w-px after:bg-border" />
      {index ? <span className="shrink-0 text-signal-text">{index}</span> : null}
    </div>
  );
}

export function SectionHeading({
  index,
  label,
  title,
  action,
}: {
  index: string;
  label: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Rule label={label} index={index} />
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <h2 className="display-3 min-w-0 text-[20px] leading-[28px] sm:text-[24px] sm:leading-[32px]">{title}</h2>
        {action}
      </div>
    </div>
  );
}

export type ClassLevel = "restricted" | "classified" | "authorized" | "notice";

export function ClassLabel({ level = "notice", children }: { level?: ClassLevel; children: ReactNode }) {
  const variant = level === "authorized" ? "" : ` dys-label--${level}`;
  return <span className={`dys-label${variant}`}>{children}</span>;
}

/** Botões: primário em bone (CLASSIFIED), secundário em borda. Cantos retos, troca de estado seca. */
export const buttonPrimary =
  "label inline-flex items-center justify-center gap-2 bg-primary px-5 py-3 text-primary-foreground transition-colors duration-150 hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50";
export const buttonSecondary =
  "label inline-flex items-center justify-center gap-2 border border-foreground px-5 py-3 text-foreground transition-colors duration-150 hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-50";

/** Abertura de página: rótulo técnico, título display e uma linha de contexto. */
export function PageHeader({
  label,
  title,
  description,
  meta,
  ruled = true,
}: {
  label: string;
  title: string;
  description?: ReactNode;
  meta?: ReactNode;
  /** Dentro de um `<Sector>` a troca de superfície já separa; a régua sobra. */
  ruled?: boolean;
}) {
  return (
    <div className={ruled ? "border-b border-border pb-8" : ""}>
      <p className="label text-foreground-muted">{label}</p>
      <h1 className="display-2 mt-4 text-[26px] leading-[34px] sm:text-[40px] sm:leading-[48px]">{title}</h1>
      {description ? <div className="mt-4 max-w-2xl text-base leading-relaxed text-foreground-muted">{description}</div> : null}
      {meta ? <div className="label mt-6 text-foreground-muted">{meta}</div> : null}
    </div>
  );
}

/**
 * Faixa de largura total com superfície própria. Seções seguidas no mesmo
 * obsidian parecem um setor só; o tom troca os papéis de cor dentro da faixa
 * (ver `.sector-*` em globals.css), então o conteúdo não muda nada.
 */
export type SectorTone = "obsidian" | "crimson" | "graphite" | "bone";

export function Sector({
  tone = "obsidian",
  id,
  narrow = false,
  compact = false,
  className = "",
  children,
}: {
  tone?: SectorTone;
  id?: string;
  narrow?: boolean;
  /** Faixa de cabeçalho (listagem): menos respiro que uma seção de conteúdo. */
  compact?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const surface = tone === "obsidian" ? "" : `sector-${tone}`;
  // Grafite encosta em obsidian dos dois lados: a régua marca o limite.
  const edge = tone === "graphite" ? "border-y border-border-faint" : "";
  return (
    <section id={id} className={`scroll-mt-24 ${surface} ${edge}`}>
      <div className={`mx-auto w-full ${narrow ? "max-w-4xl" : "max-w-7xl"} px-4 ${compact ? "py-10 sm:py-12" : "py-16 sm:py-20"} sm:px-6 lg:px-8 ${className}`}>
        {children}
      </div>
    </section>
  );
}

/**
 * Grade com régua: a grade desenha topo/esquerda e cada célula (`gridCell`)
 * desenha direita/base. Célula vazia no fim da linha fica só fundo — sem
 * bloco cinza.
 */
export const gridFrame = "grid border-l border-t border-border-faint";
export const gridCell = "border-b border-r border-border-faint";

export function ProductGrid({ children }: { children: ReactNode }) {
  return (
    <div className={`mt-8 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 ${gridFrame}`}>
      {children}
    </div>
  );
}

/** Contagem com zero à esquerda, como numa ficha: 07 itens. */
export function counted(n: number, singular: string, plural: string): string {
  return `${String(n).padStart(2, "0")} ${n === 1 ? singular : plural}`;
}

/* ------------------------------------------------------------ formulários */

export const inputClass =
  "w-full border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-foreground-muted focus:border-foreground aria-[invalid=true]:border-signal";

export const fieldLabelClass = "label text-foreground-muted";

/**
 * Erro de campo. Texto vermelho pequeno não passa contraste sobre obsidian,
 * então o erro é dito em texto legível e o vermelho vira só a marca.
 */
export function FieldError({ message, id }: { message?: string; id?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1.5 flex items-center gap-2 text-xs text-foreground">
      <span aria-hidden="true" className="h-2 w-2 shrink-0 bg-signal" />
      {message}
    </p>
  );
}

/** Alerta de formulário: preenchimento vermelho com texto bone (4,6:1). */
export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="bg-signal px-4 py-3 text-sm text-on-signal">
      {children}
    </p>
  );
}
