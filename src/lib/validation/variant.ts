/**
 * Variante de produto (tamanho/cor…). Os atributos chegam como texto livre
 * ("Tamanho: M" por linha) e saem como objeto pro `jsonb`.
 */

import { z } from "zod";
import { formStrings, optionalCents, parseForm, requiredText, wholeNumber } from "./form";

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

const variantSchema = z
  .object({
    name: requiredText("Informe o nome da variante."),
    sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,}$/, "SKU com 3+ letras/números/hífen."),
    // Preço vazio = herda o do produto (coluna é nullable de propósito).
    price: optionalCents("Preço inválido.", null),
    stock: wholeNumber("Estoque inválido."),
    attributes: z.string().transform(parseAttributes),
  })
  .transform(({ price, stock, ...rest }) => ({ ...rest, priceCents: price, stockQuantity: stock }));

export type VariantFormValues = z.output<typeof variantSchema>;

export function parseVariantForm(formData: FormData) {
  return parseForm(variantSchema, formStrings(formData, ["name", "sku", "price", "stock", "attributes"]));
}
