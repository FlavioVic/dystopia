import Link from "next/link";

/**
 * Logo do Dystopia — monograma "D" chanfrado (geométrico, sólido) sobre um
 * hexágono sutil, + wordmark "DYSTOPIA". Recriado em SVG a partir do design
 * de marca (paleta laranja: #EA580C principal, #F97316 claro, #1A1410 tinta,
 * #706A5F cinza quente). Cores expostas como CSS vars pra facilitar troca de
 * paleta (ex.: casar com o accent do site).
 */

type LogoTone = "default" | "reverse";

const DEFAULT_VARS: Record<string, string> = {
  "--logo-accent": "#EA580C",
  "--logo-accent-2": "#F97316",
  "--logo-ink": "#1A1410",
  "--logo-muted": "#706A5F",
};

// D chanfrado: silhueta externa (topo/esquerda retos = "costas" do D; cantos
// direitos cortados a 45°) com o contra-forma recortado via fill-rule evenodd.
export const D_PATH =
  "M13 10 H29 L38 19 V29 L29 38 H13 Z M21 18 H28 L30 20 V28 L28 30 H21 Z";
export const HEX_POINTS = "24,3 42.2,13.5 42.2,34.5 24,45 5.8,34.5 5.8,13.5";

export function LogoIcon({
  className = "",
  badge = false,
}: {
  className?: string;
  badge?: boolean;
}) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      {badge ? (
        <rect x="1" y="1" width="46" height="46" rx="11" fill="var(--logo-ink)" />
      ) : (
        <polygon
          points={HEX_POINTS}
          fill="none"
          stroke="var(--logo-muted)"
          strokeWidth="1.4"
          strokeLinejoin="round"
          opacity="0.4"
        />
      )}
      <path d={D_PATH} fillRule="evenodd" fill="var(--logo-accent)" />
    </svg>
  );
}

export function Logo({
  href = "/",
  tone = "default",
  showWordmark = true,
  badge = false,
  iconClassName = "h-7 w-7",
  className = "",
}: {
  href?: string | null;
  tone?: LogoTone;
  showWordmark?: boolean;
  badge?: boolean;
  iconClassName?: string;
  className?: string;
}) {
  const vars = {
    ...DEFAULT_VARS,
    ...(tone === "reverse" ? { "--logo-ink": "#F4F1EC" } : {}),
  } as React.CSSProperties;

  const content = (
    <span
      className={`inline-flex items-center gap-2 ${className}`}
      style={vars}
      aria-label="Dystopia"
    >
      <LogoIcon className={iconClassName} badge={badge} />
      {showWordmark ? (
        <span
          className="font-brand text-lg font-semibold uppercase leading-none tracking-[0.04em]"
          style={{ color: "var(--logo-ink)" }}
        >
          Dystopia
        </span>
      ) : null}
    </span>
  );

  if (href === null) return content;

  return (
    <Link href={href} className="inline-flex shrink-0 items-center">
      {content}
    </Link>
  );
}
