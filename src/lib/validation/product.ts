/**
 * Validação do formulário de produto do admin.
 *
 * Mora fora da Server Action de propósito: um arquivo `"use server"` só pode
 * exportar funções async, então nada ali dentro é testável de forma isolada.
 * Aqui é função pura — entra `FormData`, sai erro ou valores normalizados.
 */

export type ProductFormValues = {
  name: string;
  slug: string;
  description: string;
  brand: string | null;
  sku: string;
  categoryId: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  stockQuantity: number;
  isActive: boolean;
  isFeatured: boolean;
};

export type ProductFormParse = {
  errors: Record<string, string>;
  values: ProductFormValues;
};

export function field(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

// Dinheiro é regra compartilhada (produto, cupom…) — mora em @/lib/money.
export { toCents } from "@/lib/money";

import { toCents as parseCents } from "@/lib/money";

export const SLUG_PATTERN = /^[a-z0-9-]+$/;

export function parseProductForm(formData: FormData): ProductFormParse {
  const name = field(formData, "name");
  const slug = field(formData, "slug").toLowerCase();
  const description = field(formData, "description");
  const brand = field(formData, "brand") || null;
  const sku = field(formData, "sku");
  const categoryId = field(formData, "categoryId");
  const priceCents = parseCents(field(formData, "price"));
  const compareRaw = field(formData, "compareAt");
  const compareAtPriceCents = compareRaw ? parseCents(compareRaw) : null;
  const stockRaw = field(formData, "stock");
  const stockQuantity = Number.parseInt(stockRaw, 10);
  const isActive = formData.get("isActive") != null;
  const isFeatured = formData.get("isFeatured") != null;

  const errors: Record<string, string> = {};
  if (name.length < 2) errors.name = "Informe o nome.";
  if (!SLUG_PATTERN.test(slug)) errors.slug = "Slug só com letras minúsculas, números e hífen.";
  if (!description) errors.description = "Informe a descrição.";
  if (!sku) errors.sku = "Informe o SKU.";
  if (!categoryId) errors.categoryId = "Escolha a categoria.";
  if (priceCents == null) errors.price = "Preço inválido.";
  if (compareRaw && compareAtPriceCents == null) errors.compareAt = "Valor inválido.";
  if (compareAtPriceCents != null && priceCents != null && compareAtPriceCents <= priceCents) {
    errors.compareAt = 'O preço "de" precisa ser maior que o preço de venda.';
  }
  if (!Number.isInteger(stockQuantity) || stockQuantity < 0) errors.stock = "Estoque inválido.";

  return {
    errors,
    values: {
      name,
      slug,
      description,
      brand,
      sku,
      categoryId,
      priceCents: priceCents ?? 0,
      compareAtPriceCents,
      stockQuantity: Number.isInteger(stockQuantity) ? stockQuantity : 0,
      isActive,
      isFeatured,
    },
  };
}
