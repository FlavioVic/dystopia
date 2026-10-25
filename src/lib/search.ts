/**
 * Texto digitado na busca → consulta do full-text search do Postgres
 * (`to_tsquery`). Cada palavra vira prefixo (`ryz` acha "Ryzen") e todas são
 * obrigatórias. Só letra, número e hífen ENTRE eles passam: operador de
 * tsquery (`&|!<>():*`) ou curinga de LIKE digitados pelo usuário não chegam
 * ao banco. O hífen fica porque o parser do Postgres lê "GPU-1" do documento
 * como `gpu` + `-1` — quebrar a consulta no hífen procuraria `1` e não bateria.
 *
 * Devolve `null` quando não sobra termo nenhum — aí nem vale consultar.
 */
export const MAX_SEARCH_TERMS = 8;

export function toPrefixQuery(input: string): string | null {
  const terms = input
    .toLowerCase()
    .normalize("NFC")
    .split(/[^\p{L}\p{N}-]+/u)
    .map((term) => term.replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-"))
    .filter(Boolean)
    .slice(0, MAX_SEARCH_TERMS);
  return terms.length > 0 ? terms.map((term) => `${term}:*`).join(" & ") : null;
}
