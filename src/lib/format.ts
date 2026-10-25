export function formatPriceCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function discountPercent(priceCents: number, compareAtCents?: number | null): number | null {
  if (!compareAtCents || compareAtCents <= priceCents) return null;
  return Math.round((1 - priceCents / compareAtCents) * 100);
}

/** "4x de R$ 62,48 sem juros" — só faz sentido acima de um mínimo. */
export function installmentText(priceCents: number, count = 4, minCents = 6000): string | null {
  if (priceCents < minCents) return null;
  const each = Math.ceil(priceCents / count);
  return `${count}x de ${formatPriceCents(each)} sem juros`;
}

/** Regra fictícia de frete grátis: pedidos a partir de R$ 149,90. */
export const FREE_SHIPPING_MIN_CENTS = 14990;
export function isFreeShipping(priceCents: number): boolean {
  return priceCents >= FREE_SHIPPING_MIN_CENTS;
}

/**
 * Nome exibido em público (avaliações): primeiro nome e inicial do último
 * sobrenome — "Ana Souza Lima" vira "Ana L.". O nome completo não precisa
 * estar na página para a avaliação valer (LGPD: necessidade).
 */
export function publicName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Cliente";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
