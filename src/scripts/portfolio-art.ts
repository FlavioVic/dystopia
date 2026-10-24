/**
 * Diagramas do portfólio: `npm run art:portfolio`.
 *
 * Projeto sem tela pública (ou que depende de chave paga pra mostrar
 * resultado) ganha um diagrama da arquitetura REAL dele, no idioma da marca —
 * caixas, setas e rótulos em mono. Projeto com tela usa captura de verdade
 * (public/portfolio/*.webp), não isto.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const W = 1440;
const H = 900;
const OBSIDIAN = "#0b0b0c";
const GRAPHITE = "#1f2023";
const BONE = "#e7e3da";
const STEEL = "#6e7176";
const MUTED = "#8e9196";
const FAINT = "#2a2b2f";
const SIGNAL = "#c8102e";
const MONO = "'IBM Plex Mono', ui-monospace, Menlo, monospace";

type Box = { x: number; y: number; w: number; h: number; title: string; lines?: string[]; accent?: boolean };
type Arrow = { from: [number, number]; to: [number, number]; label?: string; dashed?: boolean };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function text(x: number, y: number, s: string, size = 18, color = BONE, anchor = "start", weight = 500): string {
  return `<text x="${x}" y="${y}" fill="${color}" font-family="${MONO}" font-size="${size}" font-weight="${weight}" letter-spacing="1.5" text-anchor="${anchor}">${esc(s)}</text>`;
}

function box(b: Box): string {
  const stroke = b.accent ? SIGNAL : STEEL;
  const lines = (b.lines ?? []).map((l, i) => text(b.x + 20, b.y + 74 + i * 26, l, 16, MUTED)).join("");
  return (
    `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${GRAPHITE}" stroke="${stroke}" stroke-width="2"/>` +
    (b.accent ? `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="6" fill="${SIGNAL}"/>` : "") +
    text(b.x + 20, b.y + 42, b.title.toUpperCase(), 18, BONE, "start", 600) +
    lines
  );
}

function arrow(a: Arrow): string {
  const [x1, y1] = a.from;
  const [x2, y2] = a.to;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const hx = x2 - Math.cos(ang) * 14;
  const hy = y2 - Math.sin(ang) * 14;
  const left = [hx + Math.cos(ang + Math.PI / 2) * 7, hy + Math.sin(ang + Math.PI / 2) * 7];
  const right = [hx + Math.cos(ang - Math.PI / 2) * 7, hy + Math.sin(ang - Math.PI / 2) * 7];
  const label = a.label ? text((x1 + x2) / 2 + 10, (y1 + y2) / 2 - 10, a.label, 14, MUTED) : "";
  return (
    `<line x1="${x1}" y1="${y1}" x2="${hx}" y2="${hy}" stroke="${BONE}" stroke-width="2" ${a.dashed ? 'stroke-dasharray="8 6"' : ""}/>` +
    `<polygon points="${x2},${y2} ${left[0]},${left[1]} ${right[0]},${right[1]}" fill="${BONE}"/>` +
    label
  );
}

function frame(code: string, title: string, subtitle: string, body: string): string {
  const grid =
    Array.from({ length: Math.ceil(W / 64) }, (_, i) => `<line x1="${i * 64}" y1="0" x2="${i * 64}" y2="${H}" stroke="${FAINT}"/>`).join("") +
    Array.from({ length: Math.ceil(H / 64) }, (_, i) => `<line x1="0" y1="${i * 64}" x2="${W}" y2="${i * 64}" stroke="${FAINT}"/>`).join("");
  const corner = (d: string) => `<path d="${d}" fill="none" stroke="${STEEL}" stroke-width="3"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="${OBSIDIAN}"/>
${grid}
${corner("M40 88L40 40L88 40")}${corner(`M${W - 88} 40L${W - 40} 40L${W - 40} 88`)}${corner(`M40 ${H - 88}L40 ${H - 40}L88 ${H - 40}`)}${corner(`M${W - 88} ${H - 40}L${W - 40} ${H - 40}L${W - 40} ${H - 88}`)}
${text(80, 110, code, 18, SIGNAL, "start", 600)}
${text(80, 152, title.toUpperCase(), 34, BONE, "start", 600)}
${text(80, 188, subtitle, 18, MUTED)}
${body}
${text(80, H - 72, "DIAGRAMA DE ARQUITETURA / FLÁVIO VICTOR", 14, MUTED)}
</svg>
`;
}

const PROJECTS: Record<string, string> = {
  "gamestore-bi": frame(
    "DYS-P0003",
    "GameStore BI",
    "Pergunta em português → SQL gerado por IA → resultado na hora.",
    [
      box({ x: 80, y: 260, w: 360, h: 190, title: "Angular 18 (SPA)", lines: ["consulta em linguagem natural", "tabela / JSON / SQL", "histórico"] }),
      box({ x: 540, y: 260, w: 360, h: 190, title: "FastAPI", lines: ["/api/v1/query", "/api/v1/segments", "validador de SQL seguro"], accent: true }),
      box({ x: 1000, y: 230, w: 360, h: 150, title: "Google Gemini", lines: ["NL → SQL"] }),
      box({ x: 1000, y: 420, w: 360, h: 150, title: "KMeans (RFM)", lines: ["VIP · Fiel · Casual · Inativo"] }),
      box({ x: 540, y: 560, w: 360, h: 170, title: "PostgreSQL 15", lines: ["products · orders", "customers · segments"] }),
      box({ x: 80, y: 560, w: 360, h: 170, title: "Arquitetura limpa", lines: ["ports & adapters", "casos de uso isolados"] }),
      arrow({ from: [440, 355], to: [540, 355], label: "REST" }),
      arrow({ from: [900, 320], to: [1000, 305] }),
      arrow({ from: [900, 400], to: [1000, 495] }),
      arrow({ from: [720, 450], to: [720, 560], label: "SQL" }),
    ].join(""),
  ),
  bridgekeeper: frame(
    "DYS-P0004",
    "Bridgekeeper",
    "Laboratório de Gestão de Segurança da Informação: ataque e defesa.",
    [
      box({ x: 80, y: 270, w: 330, h: 200, title: "Red Team", lines: ["reconhecimento", "exploração da API", "evidências"], accent: true }),
      box({ x: 560, y: 270, w: 330, h: 200, title: "NGINX (proxy)", lines: ["proxy reverso", "logs de acesso"] }),
      box({ x: 1030, y: 270, w: 330, h: 200, title: "API Node.js / TS", lines: ["/orders", "dados de seed"] }),
      box({ x: 560, y: 570, w: 330, h: 170, title: "Volume de logs", lines: ["formato compartilhado"] }),
      box({ x: 1030, y: 570, w: 330, h: 170, title: "Blue Team", lines: ["detecção", "resposta a incidente"] }),
      arrow({ from: [410, 370], to: [560, 370], label: "HTTP" }),
      arrow({ from: [890, 370], to: [1030, 370] }),
      arrow({ from: [725, 470], to: [725, 570] }),
      arrow({ from: [890, 655], to: [1030, 655], dashed: true, label: "análise" }),
      text(80, 560, "DOCKER COMPOSE · BRANCHES POR TIME", 15, MUTED),
    ].join(""),
  ),
  "corretor-texto": frame(
    "DYS-P0005",
    "Corretor de texto",
    "Correção ortográfica e gramatical em pt-BR que aprende com o usuário.",
    [
      box({ x: 80, y: 280, w: 380, h: 220, title: "Interface web", lines: ["Jinja2 + FastAPI", "texto de entrada", "sugestão / correção manual"] }),
      box({ x: 560, y: 280, w: 380, h: 220, title: "LanguageTool pt-BR", lines: ["regras gramaticais", "carregado no startup"], accent: true }),
      box({ x: 1040, y: 280, w: 320, h: 220, title: "Histórico", lines: ["correções confirmadas", "historico.json"] }),
      arrow({ from: [460, 390], to: [560, 390], label: "texto" }),
      arrow({ from: [940, 390], to: [1040, 390], label: "confirma" }),
      arrow({ from: [1200, 500], to: [270, 500], dashed: true }),
      text(500, 560, "A CORREÇÃO CONFIRMADA VOLTA COMO SUGESTÃO DA PRÓXIMA VEZ", 15, MUTED),
    ].join(""),
  ),
};

function main(): void {
  const dir = join(process.cwd(), "public/portfolio");
  mkdirSync(dir, { recursive: true });
  for (const [slug, svg] of Object.entries(PROJECTS)) writeFileSync(join(dir, `${slug}.svg`), svg);
  console.log(`diagramas gerados: ${Object.keys(PROJECTS).length}`);
}

main();
