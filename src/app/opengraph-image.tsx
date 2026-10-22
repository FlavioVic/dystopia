import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { D_PATH, HEX_POINTS } from "@/components/Logo";

/**
 * Prévia do link (LinkedIn, WhatsApp, X…). Gerada no build a partir daqui,
 * então muda junto com o código — não é um PNG solto pra lembrar de refazer.
 *
 * O renderizador do `next/og` não lê CSS vars nem WOFF2: as cores repetem os
 * tokens de globals.css (--accent, --magenta, --violet, --amber-bright) e a
 * fonte da marca vem do TTF ao lado dos WOFF2.
 */

export const alt = "Dystopia — e-commerce geek com checkout orquestrado por SAGA";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ACCENT = "#c2410c";
const MAGENTA = "#db2777";
const VIOLET = "#7c3aed";
const AMBER = "#fbbf24";

const TAGS = ["Next.js 16", "PostgreSQL", "SAGA", "Outbox", "TypeScript"];

// Hexágonos de fundo, como no hero da home: [x, y, tamanho, opacidade].
const HEXES: [number, number, number, number][] = [
  [820, -40, 300, 0.16],
  [1010, 210, 220, 0.12],
  [860, 380, 260, 0.1],
  [1080, 470, 160, 0.14],
];

export default async function OpenGraphImage() {
  const brandFont = await readFile(join(process.cwd(), "src/app/fonts/ChakraPetch-Bold.ttf"));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          color: "white",
          backgroundImage: `linear-gradient(100deg, ${ACCENT} 0%, ${MAGENTA} 55%, ${VIOLET} 100%)`,
          position: "relative",
        }}
      >
        {HEXES.map(([x, y, s, opacity]) => (
          <svg
            key={`${x}-${y}`}
            width={s}
            height={s}
            viewBox="0 0 48 48"
            style={{ position: "absolute", left: x, top: y, opacity }}
          >
            <polygon points={HEX_POINTS} fill="none" stroke="white" strokeWidth="1.2" />
          </svg>
        ))}

        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              display: "flex",
              width: 72,
              height: 72,
              borderRadius: 16,
              background: "white",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="60" height="60" viewBox="0 0 48 48">
              <path d={D_PATH} fillRule="evenodd" fill={ACCENT} />
            </svg>
          </div>
          {/* Mesmo kerning óptico do T-O da logo do site (−0,06em). */}
          <div style={{ display: "flex", fontFamily: "Chakra Petch", fontSize: 44, letterSpacing: 3 }}>
            <span>DYS</span>
            <span style={{ letterSpacing: 3 - 0.06 * 44 }}>T</span>
            <span>OPIA</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", maxWidth: 940 }}>
          <div style={{ fontSize: 24, letterSpacing: 6, color: AMBER, fontWeight: 700 }}>PROJETO DE PORTFÓLIO</div>
          <div
            style={{
              marginTop: 18,
              fontFamily: "Chakra Petch",
              fontSize: 62,
              lineHeight: 1.04,
              textTransform: "uppercase",
            }}
          >
            Checkout que não deixa pedido pela metade
          </div>
          <div style={{ marginTop: 24, fontSize: 28, lineHeight: 1.35, opacity: 0.9 }}>
            E-commerce geek em Next.js + Postgres: SAGA com fila durável, compensação e observabilidade.
          </div>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          {TAGS.map((tag) => (
            <div
              key={tag}
              style={{
                display: "flex",
                padding: "8px 18px",
                borderRadius: 999,
                border: "2px solid rgba(255,255,255,0.45)",
                background: "rgba(255,255,255,0.12)",
                fontSize: 22,
              }}
            >
              {tag}
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Chakra Petch", data: brandFont, weight: 700, style: "normal" }],
    },
  );
}
