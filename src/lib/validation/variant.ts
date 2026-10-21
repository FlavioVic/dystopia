/**
 * Validação de variante de produto (tamanho/cor…). Pura.
 *
 * Os atributos chegam como texto livre ("Tamanho: M" por linha) e saem como
 * objeto pro `jsonb` — o schema guarda pares livres de propósito, então a
 * normalização precisa morar em algum lugar testável.
 */

import { toCents } from "@/lib/money";

export type VariantFormValues = {
  name: string;
  sku: string;
  priceCents: number | null;
  stockQuantity: number;
  attributes: Record<string, string>;
};

export type VariantFormParse = {
  errors: Record<string, string>;
  values: VariantFormValues;
};

/** "Tamanho: M\nCor: Preto" → { Tamanho: "M", Cor: "Preto" } */
export function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key && value) attributes[key] = value;
  }
  return attributes;
}

export function formatAttributes(attributes: unknown): string {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return "";
  return Object.entries(attributes as Record<string, unknown>)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("\n");
}

function field(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export function parseVariantForm(formData: FormData): VariantFormParse {
  const name = field(formData, "name");
  const sku = field(formData, "sku").toUpperCase();
  const priceRaw = field(formData, "price");
  const stockRaw = field(formData, "stock");
  const attributes = parseAttributes(String(formData.get("attributes") ?? ""));

  const errors: Record<string, string> = {};
  if (name.length < 1) errors.name = "Informe o nome da variante.";
  if (!/^[A-Z0-9-]{3,}$/.test(sku)) errors.sku = "SKU com 3+ letras/números/hífen.";

  // Preço vazio = herda o do produto (coluna é nullable de propósito).
  const priceCents = priceRaw ? toCents(priceRaw) : null;
  if (priceRaw && priceCents == null) errors.price = "Preço inválido.";

  const stockQuantity = /^\d+$/.test(stockRaw) ? Number.parseInt(stockRaw, 10) : Number.NaN;
  if (!Number.isInteger(stockQuantity) || stockQuantity < 0) errors.stock = "Estoque inválido.";

  return {
    errors,
    values: {
      name,
      sku,
      priceCents,
      stockQuantity: Number.isInteger(stockQuantity) ? stockQuantity : 0,
      attributes,
    },
  };
}
