/**
 * Texto do assistente → pedaços para a tela. Só `[texto](/caminho)` vira link,
 * e só para página do próprio site: um modelo enganado por uma pergunta
 * maliciosa não consegue pôr link externo (phishing) na boca da loja. O resto
 * é texto puro — nada de HTML vindo do modelo.
 */

export type RichSegment = { type: "text"; text: string } | { type: "link"; text: string; href: string };

const LINK = /\[([^\]\n]{1,120})\]\(([^)\s]{1,200})\)/g;
/** Caminho interno: começa com uma barra só (`//host` seria outro site). */
const INTERNAL_PATH = /^\/(?!\/)[\w\-./?=&%#]*$/;

export function parseRichText(input: string): RichSegment[] {
  // Negrito de markdown não tem vez no tom da marca: some, o texto fica.
  const source = input.replace(/\*\*([^*]+)\*\*/g, "$1");
  const segments: RichSegment[] = [];
  let last = 0;
  for (const match of source.matchAll(LINK)) {
    const [whole, text, href] = match;
    const start = match.index ?? 0;
    if (start > last) segments.push({ type: "text", text: source.slice(last, start) });
    segments.push(INTERNAL_PATH.test(href) ? { type: "link", text, href } : { type: "text", text });
    last = start + whole.length;
  }
  if (last < source.length) segments.push({ type: "text", text: source.slice(last) });
  return segments;
}
