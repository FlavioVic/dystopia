/**
 * Argumentos de Server Action chamada com id ou número (carrinho, favoritos,
 * endereços, avaliação). A tela sempre manda o tipo certo, mas a action é um
 * endpoint público: quem a chama à mão manda o que quiser. Sem esta checagem,
 * um id que não é UUID chegava ao Postgres e voltava como erro 500 — nada
 * vazava (a consulta é parametrizada), mas a resposta certa é "não
 * encontrado", não um erro no log.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Número de verdade (o serviço limita a faixa). `"abc"`, `NaN` e `Infinity` não passam. */
export function isQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
