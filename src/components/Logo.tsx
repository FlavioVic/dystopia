import Link from "next/link";
import { GATE_PATH, GATE_STENCIL_PATH, WORDMARK_PATH, WORDMARK_WIDTH } from "@/lib/brand-geometry";

/**
 * Marcas da DYSTOPIA, desenhadas a partir da geometria do design system — o
 * emblema ("The Gate") e o nome nunca são digitados nem redesenhados.
 *
 * Uma cor só, herdada de `color` (currentColor): `ink` por padrão; o emblema
 * vai em `signal` só quando carrega autoridade (no máximo um por tela). O nome
 * nunca é vermelho.
 */

type MarkProps = { className?: string; title?: string };

function a11y(title?: string) {
  return title ? { role: "img", "aria-label": title } : { "aria-hidden": true as const, focusable: "false" as const };
}

/** Emblema. `size` em px (mínimo 16). */
export function Emblem({ size = 48, stencil = false, className, title }: MarkProps & { size?: number; stencil?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...a11y(title)}>
      <path d={stencil ? GATE_STENCIL_PATH : GATE_PATH} fill="currentColor" />
    </svg>
  );
}

/** Nome desenhado. `height` = altura da caixa alta em px (mínimo 6). */
export function Wordmark({ height = 16, className, title = "DYSTOPIA" }: MarkProps & { height?: number }) {
  return (
    <svg
      height={height}
      width={(height * WORDMARK_WIDTH) / 100}
      viewBox={`0 0 ${WORDMARK_WIDTH} 100`}
      className={className}
      {...a11y(title)}
    >
      <path d={WORDMARK_PATH} fill="currentColor" />
    </svg>
  );
}

// Lockup horizontal, em unidades do emblema (24u): emblema, 8u de vão, nome
// com caixa alta de 8u centralizado no emblema. O vão faz parte da marca —
// não monte emblema + nome lado a lado na mão.
const H_GAP = 8;
const H_CAP = 8;
const H_WIDTH = 24 + H_GAP + (WORDMARK_WIDTH * H_CAP) / 100;

/** Assinatura principal. `size` = diâmetro do emblema em px (mínimo 24). */
export function Lockup({ size = 32, className, title = "DYSTOPIA" }: MarkProps & { size?: number }) {
  return (
    <svg
      width={(size * H_WIDTH) / 24}
      height={size}
      viewBox={`0 0 ${H_WIDTH} 24`}
      className={className}
      {...a11y(title)}
    >
      <path d={GATE_PATH} fill="currentColor" />
      <path
        d={WORDMARK_PATH}
        fill="currentColor"
        transform={`translate(${24 + H_GAP} ${12 - H_CAP / 2}) scale(${H_CAP / 100})`}
      />
    </svg>
  );
}

/** O lockup como link pra home (cabeçalho, rodapé). */
export function Logo({ href = "/", size = 28, className = "" }: { href?: string | null; size?: number; className?: string }) {
  const mark = <Lockup size={size} className={`shrink-0 text-foreground ${className}`} />;
  if (href === null) return mark;
  return (
    <Link href={href} aria-label="DYSTOPIA — início" className="inline-flex shrink-0 items-center">
      {mark}
    </Link>
  );
}

/**
 * Vinheta do emblema (design system: MotionSting). Os três círculos da
 * construção são desenhados em steel, as duas linhas do seam são riscadas e,
 * em 1,68 s, corte seco pro emblema sólido. As folhas nunca se mexem.
 */
export function EmblemSting({ size = 240, className, title }: MarkProps & { size?: number }) {
  const circle = (r: number, delay: number) => (
    <circle
      cx="12"
      cy="12"
      r={r}
      fill="none"
      stroke="var(--steel)"
      strokeWidth="0.12"
      className="sting-line"
      transform="rotate(-90 12 12)"
      style={{ "--len": `${(2 * Math.PI * r).toFixed(2)}`, "--delay": `${delay}ms` } as React.CSSProperties}
    />
  );
  const seam = (x: number) => (
    <line
      x1={x}
      y1="0"
      x2={x}
      y2="24"
      stroke="var(--steel)"
      strokeWidth="0.12"
      className="sting-line"
      style={{ "--len": "24", "--delay": "1200ms", animationDuration: "240ms" } as React.CSSProperties}
    />
  );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...a11y(title)}>
      <g className="sting-construction">
        {circle(12, 0)}
        {circle(9, 240)}
        {circle(7, 480)}
        {seam(10.5)}
        {seam(13.5)}
      </g>
      <path d={GATE_PATH} fill="currentColor" className="sting-solid" />
    </svg>
  );
}
