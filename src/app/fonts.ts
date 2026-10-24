import localFont from "next/font/local";

/**
 * Fontes da marca DYSTOPIA, auto-hospedadas (subsets latinos do design system,
 * SIL OFL 1.1 — ver fonts/OFL.txt). Sem requisição externa em runtime.
 *
 * - Michroma: display. Só caixa alta, sempre com tracking, nunca abaixo de 12px.
 * - Inter Tight: tudo que se lê como frase.
 * - IBM Plex Mono: códigos, seriais, preços, rótulos.
 */
export const michroma = localFont({
  src: [{ path: "./fonts/Michroma-Regular.woff2", weight: "400", style: "normal" }],
  display: "swap",
  variable: "--font-michroma",
});

export const interTight = localFont({
  src: [{ path: "./fonts/InterTight-Variable.woff2", weight: "100 900", style: "normal" }],
  display: "swap",
  variable: "--font-inter-tight",
});

export const plexMono = localFont({
  src: [
    { path: "./fonts/IBMPlexMono-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/IBMPlexMono-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/IBMPlexMono-SemiBold.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
  variable: "--font-plex-mono",
});
