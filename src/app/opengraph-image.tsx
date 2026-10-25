import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { GATE_PATH, WORDMARK_PATH, WORDMARK_WIDTH } from "@/lib/brand-geometry";
import { SERVICES } from "@/lib/services-catalog";

/**
 * Prévia do link (LinkedIn, WhatsApp, X…). Gerada no build a partir daqui,
 * então muda junto com o código — não é um PNG solto para lembrar de refazer.
 *
 * O renderizador do `next/og` não lê CSS vars nem WOFF2: as cores repetem a
 * paleta de globals.css e as fontes vêm dos TTF ao lado dos WOFF2.
 */

export const alt = "DYSTOPIA — desenvolvimento de software, montagem, manutenção e formatação de computadores, por Flávio Victor";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const OBSIDIAN = "#0b0b0c";
const BONE = "#e7e3da";
const STEEL = "#6e7176";
const MUTED = "#8e9196";
const FAINT = "#2a2b2f";
const SIGNAL = "#c8102e";

export default async function OpenGraphImage() {
  const [display, mono] = await Promise.all([
    readFile(join(process.cwd(), "src/app/fonts/Michroma-Regular.ttf")),
    readFile(join(process.cwd(), "src/app/fonts/IBMPlexMono-Medium.ttf")),
  ]);

  const wordmarkCap = 22;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: OBSIDIAN,
          color: BONE,
          fontFamily: "Plex",
          backgroundImage: `linear-gradient(to right, ${FAINT} 1px, transparent 1px), linear-gradient(to bottom, ${FAINT} 1px, transparent 1px)`,
          backgroundSize: "64px 64px",
        }}
      >
        {/* Faixa de ação, como no topo do site. */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: SIGNAL,
            padding: "14px 56px",
            fontSize: 17,
            letterSpacing: 3,
          }}
        >
          <div style={{ display: "flex" }}>ORÇAMENTO SEM CUSTO</div>
          <div style={{ display: "flex" }}>FLÁVIO VICTOR / DESENVOLVIMENTO E HARDWARE</div>
        </div>

        <div style={{ display: "flex", flex: 1, padding: "48px 56px 44px", gap: 48 }}>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1 }}>
            <svg width={(wordmarkCap * WORDMARK_WIDTH) / 100} height={wordmarkCap} viewBox={`0 0 ${WORDMARK_WIDTH} 100`}>
              <path d={WORDMARK_PATH} fill={BONE} />
            </svg>

            <div style={{ display: "flex", flexDirection: "column", fontFamily: "Michroma", fontSize: 62, letterSpacing: 5, lineHeight: 1.15 }}>
              <div style={{ display: "flex" }}>A ORDEM É UM</div>
              <div style={{ display: "flex", color: SIGNAL }}>SERVIÇO.</div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", height: 1, background: STEEL }} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {SERVICES.map((s, i) => (
                  <div
                    key={s.kind}
                    style={{ display: "flex", alignItems: "center", gap: 10, border: `2px solid ${BONE}`, padding: "7px 12px", fontSize: 16, letterSpacing: 2 }}
                  >
                    <span style={{ color: SIGNAL }}>{String(i + 1).padStart(2, "0")}</span>
                    {s.name.toUpperCase()}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22, width: 300 }}>
            <svg width="260" height="260" viewBox="0 0 24 24">
              <path d={GATE_PATH} fill={SIGNAL} />
            </svg>
            <div style={{ display: "flex", fontSize: 15, letterSpacing: 3, color: MUTED }}>DYS-0001 / SETOR 04</div>
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
