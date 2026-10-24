/**
 * Gera as placas técnicas do catálogo: `npm run art`.
 *
 * Uma imagem por produto (public/images/products/<slug>.svg) e por categoria
 * (public/images/categories/<slug>.svg), desenhadas no idioma da marca:
 * desenho de linha da peça em bone sobre obsidian, grade de fundo em
 * rule-faint, cantoneiras e serial em mono. Nada de foto de terceiros — e o
 * vermelho não aparece (é reservado a alerta, e a imagem não alerta nada).
 *
 * Determinístico: rodar de novo reescreve os mesmos arquivos.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SEED_CATEGORIES, SEED_PRODUCTS, type ArtKind } from "@/db/seed-catalog";

const OBSIDIAN = "#0b0b0c";
const BONE = "#e7e3da";
const STEEL = "#6e7176";
const MUTED = "#8e9196";
const FAINT = "#2a2b2f";

const SIZE = 800;
const MONO = "'IBM Plex Mono', ui-monospace, Menlo, monospace";

const line = (d: string, w = 3, color = BONE) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="square" stroke-linejoin="miter"/>`;
const rect = (x: number, y: number, w: number, h: number, sw = 3, color = BONE) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="${sw}"/>`;
const circle = (cx: number, cy: number, r: number, sw = 3, color = BONE) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}"/>`;
const fill = (x: number, y: number, w: number, h: number, color = BONE) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}"/>`;

function repeat(n: number, f: (i: number) => string): string {
  return Array.from({ length: n }, (_, i) => f(i)).join("");
}

/** Ventoinha vista de frente: aro, cubo e pás retas (sem curva decorativa). */
function fan(cx: number, cy: number, r: number): string {
  const blades = repeat(7, (i) => {
    const a = (i / 7) * Math.PI * 2;
    const x1 = cx + Math.cos(a) * r * 0.32;
    const y1 = cy + Math.sin(a) * r * 0.32;
    const x2 = cx + Math.cos(a + 0.5) * r * 0.86;
    const y2 = cy + Math.sin(a + 0.5) * r * 0.86;
    return line(`M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`, 2, STEEL);
  });
  return circle(cx, cy, r) + circle(cx, cy, r * 0.3, 2) + blades;
}

// Cada desenho ocupa a área útil 120..680 (560 de lado), centrado.
const DRAWINGS: Record<ArtKind, () => string> = {
  gpu: () =>
    rect(110, 250, 580, 250) +
    fan(260, 375, 95) +
    fan(540, 375, 95) +
    line("M110 250L90 250L90 520L110 520", 3) + // espelho
    repeat(14, (i) => fill(200 + i * 22, 500, 14, 22, STEEL)) + // contatos PCIe
    rect(600, 220, 60, 30, 2) + // conector de força
    line("M140 280L380 280", 2, STEEL),
  cpu: () =>
    rect(180, 180, 440, 440) +
    rect(250, 250, 300, 300) +
    line("M180 220L220 180", 3) + // marcador do pino 1
    repeat(9, (i) => repeat(2, (j) => fill(205 + i * 46, j === 0 ? 196 : 590, 8, 14, STEEL))) +
    repeat(9, (i) => repeat(2, (j) => fill(j === 0 ? 196 : 590, 205 + i * 46, 14, 8, STEEL))) +
    line("M290 470L510 470", 2, STEEL) +
    line("M290 500L440 500", 2, STEEL),
  motherboard: () =>
    rect(150, 120, 500, 560) +
    rect(240, 190, 150, 150) + // soquete
    rect(265, 215, 100, 100, 2, STEEL) +
    repeat(4, (i) => rect(450 + i * 34, 170, 14, 230, 2)) + // DIMMs
    repeat(3, (i) => rect(200, 440 + i * 70, 340, 18, 2)) + // PCIe
    rect(560, 450, 60, 60, 2, STEEL) + // chipset
    rect(200, 380, 200, 22, 2, STEEL) + // M.2
    repeat(4, (i) => circle(175 + (i % 2) * 450, 145 + Math.floor(i / 2) * 510, 8, 2, STEEL)),
  ram: () =>
    rect(110, 320, 580, 150) +
    repeat(8, (i) => rect(140 + i * 66, 350, 50, 70, 2, STEEL)) +
    repeat(40, (i) => (i === 18 ? "" : fill(122 + i * 14, 470, 9, 20, STEEL))) +
    line("M110 300L690 300", 2, STEEL),
  ssd: () =>
    rect(110, 340, 580, 120) +
    `<path d="M690 380A20 20 0 0 1 690 420" fill="none" stroke="${BONE}" stroke-width="3"/>` + // furo do parafuso
    rect(160, 365, 90, 70, 2) + // controlador
    rect(290, 360, 150, 80, 2, STEEL) +
    rect(470, 360, 150, 80, 2, STEEL) +
    repeat(10, (i) => fill(84, 350 + i * 10, 26, 5, STEEL)),
  psu: () =>
    rect(150, 210, 500, 380) +
    circle(330, 400, 140) +
    repeat(5, (i) => circle(330, 400, 28 + i * 24, 2, STEEL)) +
    repeat(6, (i) => rect(520, 260 + i * 50, 90, 30, 2)) +
    line("M150 560L650 560", 2, STEEL),
  case: () =>
    rect(220, 110, 360, 580) +
    rect(250, 150, 220, 480, 2) + // janela lateral
    repeat(24, (i) => line(`M500 ${150 + i * 20}L550 ${150 + i * 20}`, 2, STEEL)) + // malha frontal
    circle(525, 135, 8, 2) +
    line("M240 690L240 710M560 690L560 710", 3),
  cooler: () =>
    repeat(22, (i) => line(`M250 ${180 + i * 20}L550 ${180 + i * 20}`, 2, i % 5 === 0 ? BONE : STEEL)) +
    rect(250, 170, 300, 440) +
    rect(180, 260, 70, 260) + // ventoinha de lado
    repeat(4, (i) => line(`M${320 + i * 54} 610L${320 + i * 54} 680`, 3)) + // heatpipes
    rect(300, 660, 200, 30, 2, STEEL),
  aio: () =>
    rect(100, 180, 600, 200) +
    fan(200, 280, 80) +
    fan(400, 280, 80) +
    fan(600, 280, 80) +
    line("M320 380C320 470 360 500 400 520M480 380C480 470 440 500 420 520", 3) +
    circle(410, 580, 70) +
    circle(410, 580, 40, 2, STEEL),
  monitor: () =>
    rect(110, 170, 580, 340) +
    rect(130, 190, 540, 300, 2, STEEL) +
    line("M400 510L400 610", 4) +
    line("M290 620L510 620", 4) +
    repeat(6, (i) => line(`M150 ${220 + i * 40}L${380 - i * 30} ${220 + i * 40}`, 2, FAINT)),
  mouse: () =>
    `<path d="M400 170C300 170 270 260 270 360L270 500C270 600 330 640 400 640C470 640 530 600 530 500L530 360C530 260 500 170 400 170Z" fill="none" stroke="${BONE}" stroke-width="3"/>` +
    line("M400 170L400 330", 2) +
    rect(388, 220, 24, 60, 2) +
    line("M270 330L530 330", 2, STEEL),
  keyboard: () =>
    rect(90, 270, 620, 260) +
    repeat(5, (r) =>
      repeat(14 - (r === 4 ? 6 : 0), (c) =>
        r === 4 && c === 3 ? rect(110 + c * 42, 290 + r * 46, 220, 34, 2) : r === 4 && c > 3 ? "" : rect(110 + c * 42, 290 + r * 46, 34, 34, 2, STEEL),
      ),
    ) +
    repeat(3, (i) => rect(110 + (10 + i) * 42 + 20, 290 + 4 * 46, 34, 34, 2, STEEL)),
  headset: () =>
    `<path d="M220 470L220 380C220 250 300 170 400 170C500 170 580 250 580 380L580 470" fill="none" stroke="${BONE}" stroke-width="4"/>` +
    rect(180, 440, 90, 180) +
    rect(530, 440, 90, 180) +
    rect(200, 460, 50, 140, 2, STEEL) +
    rect(550, 460, 50, 140, 2, STEEL) +
    line("M230 620C230 680 300 700 360 700", 3, STEEL) +
    circle(370, 700, 10, 2),
};

function frame(serial: string): string {
  const arm = 36;
  const corners = [
    `M40 ${40 + arm}L40 40L${40 + arm} 40`,
    `M${SIZE - 40 - arm} 40L${SIZE - 40} 40L${SIZE - 40} ${40 + arm}`,
    `M40 ${SIZE - 40 - arm}L40 ${SIZE - 40}L${40 + arm} ${SIZE - 40}`,
    `M${SIZE - 40 - arm} ${SIZE - 40}L${SIZE - 40} ${SIZE - 40}L${SIZE - 40} ${SIZE - 40 - arm}`,
  ]
    .map((d) => line(d, 4, STEEL))
    .join("");
  const grid = repeat(12, (i) => line(`M${(i + 1) * 64 - 16} 0L${(i + 1) * 64 - 16} ${SIZE}`, 1, FAINT)) +
    repeat(12, (i) => line(`M0 ${(i + 1) * 64 - 16}L${SIZE} ${(i + 1) * 64 - 16}`, 1, FAINT));
  const text = (x: number, y: number, s: string, anchor = "start", color = MUTED, size = 20) =>
    `<text x="${x}" y="${y}" fill="${color}" font-family="${MONO}" font-size="${size}" font-weight="500" letter-spacing="2.8" text-anchor="${anchor}">${escape(s)}</text>`;
  return (
    grid +
    corners +
    // O topo fica livre: é onde o card põe os rótulos (desconto, salvar).
    text(64, SIZE - 64, serial, "start", BONE, 22) +
    text(SIZE - 64, SIZE - 64, "SETOR 04", "end")
  );
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function svg(kind: ArtKind, serial: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
<rect width="${SIZE}" height="${SIZE}" fill="${OBSIDIAN}"/>
${frame(serial)}
${DRAWINGS[kind]()}
</svg>
`;
}

function main(): void {
  const root = process.cwd();
  const productsDir = join(root, "public/images/products");
  const categoriesDir = join(root, "public/images/categories");
  mkdirSync(productsDir, { recursive: true });
  mkdirSync(categoriesDir, { recursive: true });

  for (const p of SEED_PRODUCTS) {
    writeFileSync(join(productsDir, `${p.slug}.svg`), svg(p.art, `${p.sku} / ${p.brand.toUpperCase()}`));
  }
  SEED_CATEGORIES.forEach((c, i) => {
    writeFileSync(join(categoriesDir, `${c.slug}.svg`), svg(c.art, `DYS-C${String(i + 1).padStart(4, "0")}`));
  });
  console.log(`placas geradas: ${SEED_PRODUCTS.length} produtos, ${SEED_CATEGORIES.length} categorias`);
}

main();
