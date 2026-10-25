/**
 * Paginação por número de página (`?pagina=2`). Função pura: quem consulta
 * usa `offset`/`limit`, quem desenha usa `pageCount`.
 */

export const STORE_PAGE_SIZE = 12; // cabe inteiro nas grades de 2, 3 e 4 colunas
export const ADMIN_PAGE_SIZE = 25;

export type Page = { page: number; limit: number; offset: number };

/** Página pedida na URL. Qualquer coisa que não seja inteiro ≥ 1 vira 1. */
export function parsePage(raw: unknown, pageSize: number): Page {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const page = typeof value === "string" && /^\d{1,6}$/.test(value) ? Math.max(1, Number(value)) : 1;
  return { page, limit: pageSize, offset: (page - 1) * pageSize };
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Página além da última (e não é a 1ª de uma lista vazia): a URL não existe. */
export function isPastLastPage(page: number, total: number, pageSize: number): boolean {
  return page > pageCount(total, pageSize);
}
