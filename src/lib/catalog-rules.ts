/**
 * Regras do catálogo que a tela também precisa para EXIBIR — puras, sem
 * banco, então servem ao servidor e ao navegador. Quem decide é o servidor
 * (serviços e casos de uso); a tela só mostra o mesmo número, lido daqui em
 * vez de uma cópia que pode ficar para trás.
 */

/** Teto de unidades de um item no carrinho (além do estoque). */
export const MAX_PER_ITEM = 10;

/** Estoque "baixo": selo "Últimas N" na loja e destaque no painel. */
export const LOW_STOCK_MAX = 3;

/** Ainda tem, mas pouco. */
export function isLowStock(stock: number): boolean {
  return stock > 0 && stock <= LOW_STOCK_MAX;
}

/** Preço de venda: o da variante, se ela tiver preço próprio; senão, o do produto. */
export function unitPriceCents(productPriceCents: number, variantPriceCents: number | null | undefined): number {
  return variantPriceCents ?? productPriceCents;
}
