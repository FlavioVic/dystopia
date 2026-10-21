/**
 * Conversão de dinheiro digitado → centavos. Vive sozinha porque é usada pelo
 * formulário de produto, pelo de cupom e por qualquer coisa futura que peça
 * valor em reais: regra de dinheiro duplicada é como nasce bug de centavo.
 */

/**
 * "19,90" / "19.90" → 1990. Campo vazio é `null` (inválido), NÃO zero —
 * `Number("")` é 0, e isso já salvou produto a R$ 0,00 por acidente.
 */
export function toCents(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

/** Igual a `toCents`, mas campo vazio vira o padrão informado. */
export function toCentsOrDefault(value: string, fallback: number): number | null {
  if (!value.trim()) return fallback;
  return toCents(value);
}
