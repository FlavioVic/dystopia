import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { GATE_PATH, WORDMARK_PATH, WORDMARK_WIDTH } from "@/lib/brand-geometry";

/**
 * Prévia do link (LinkedIn, WhatsApp, X…). Gerada no build a partir daqui,
 * então muda junto com o código — não é um PNG solto pra lembrar de refazer.
 *
 * O renderizador do `next/og` não lê CSS vars nem WOFF2: as cores repetem a
 * paleta de globals.css e as fontes vêm dos TTF ao lado dos WOFF2 (convertidos
 * dos mesmos arquivos do design system).
 */

export const alt = "DYSTOPIA — loja de hardware e serviços técnicos, projeto de portfólio de Flávio Victor";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const OBSIDIAN = "#0b0b0c";
const BONE = "#e7e3da";
const STEEL = "#6e7176";
const MUTED = "#8e9196";
const FAINT = "#2a2b2f";
const SIGNAL = "#c8102e";

const SPEC = ["NEXT.JS 16", "POSTGRESQL", "SAGA", "OUTBOX", "FILA DURÁVEL"];

export default async function OpenGraphImage() {
  const [display, mono] = await Promise.all([
    readFile(join(process.cwd(), "src/app/fonts/Michroma-Regular.ttf")),
    readFile(join(process.cwd(), "src/app/fonts/IBMPlexMono-Medium.ttf")),
  ]);

  const wordmarkCap = 34;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          background: OBSIDIAN,
          color: BONE,
          fontFamily: "Plex",
          // Grade modular (rule-faint), como no fundo das páginas.
          backgroundImage: `linear-gradient(to right, ${FAINT} 1px, transparent 1px), linear-gradient(to bottom, ${FAINT} 1px, transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
            <svg width="84" height="84" viewBox="0 0 24 24">
              <path d={GATE_PATH} fill={SIGNAL} />
            </svg>
            <svg
              width={(wordmarkCap * WORDMARK_WIDTH) / 100}
              height={wordmarkCap}
              viewBox={`0 0 ${WORDMARK_WIDTH} 100`}
            >
              <path d={WORDMARK_PATH} fill={BONE} />
            </svg>
          </div>
          <div style={{ display: "flex", fontSize: 18, letterSpacing: 3, color: MUTED }}>DYS-0001 / SETOR 04</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", fontFamily: "Michroma", fontSize: 58, letterSpacing: 6, lineHeight: 1.2 }}>
            A ORDEM É UM SERVIÇO.
          </div>
          <div style={{ display: "flex", fontSize: 24, color: MUTED, letterSpacing: 1 }}>
            Hardware, montagem, manutenção e desenvolvimento de software.
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", height: 1, background: STEEL }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 14 }}>
              {SPEC.map((tag) => (
                <div
                  key={tag}
                  style={{
                    display: "flex",
                    border: `2px solid ${BONE}`,
                    padding: "6px 12px",
                    fontSize: 16,
                    letterSpacing: 2,
                  }}
                >
                  {tag}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", fontSize: 18, letterSpacing: 2, color: BONE }}>
              PORTFÓLIO / FLÁVIO VICTOR
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Michroma", data: display, weight: 400, style: "normal" },
        { name: "Plex", data: mono, weight: 500, style: "normal" },
      ],
    },
  );
}
