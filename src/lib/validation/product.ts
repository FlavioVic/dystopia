/**
 * Formulário de produto do admin.
 */

import { z } from "zod";
import { checked, cents, formStrings, optionalCents, optionalText, parseForm, requiredText, wholeNumber } from "./form";

// Dinheiro é regra compartilhada (produto, cupom…) — mora em @/lib/money.
export { toCents } from "@/lib/money";

/** Campo de texto avulso (ex.: URL da imagem no "novo produto"). */
export function field(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export const SLUG_PATTERN = /^[a-z0-9-]+$/;

const productSchema = z
  .object({
    name: requiredText("Informe o nome.", 2),
    slug: z.string().trim().toLowerCase().regex(SLUG_PATTERN, "Slug só com letras minúsculas, números e hífen."),
    description: requiredText("Informe a descrição."),
    brand: optionalText(),
    sku: requiredText("Informe o SKU."),
    categoryId: requiredText("Escolha a categoria."),
    price: cents("Preço inválido."),
    compareAt: optionalCents("Valor inválido.", null),
    stock: wholeNumber("Estoque inválido."),
    isActive: z.boolean(),
    isFeatured: z.boolean(),
  })
  .superRefine((product, ctx) => {
    if (product.compareAt != null && product.compareAt <= product.price) {
      ctx.addIssue({ code: "custom", path: ["compareAt"], message: 'O preço "de" precisa ser maior que o preço de venda.' });
    }
  })
  .transform(({ price, compareAt, stock, ...rest }) => ({
    ...rest,
    priceCents: price,
    compareAtPriceCents: compareAt,
    stockQuantity: stock,
  }));

export type ProductFormValues = z.output<typeof productSchema>;

const FIELDS = ["name", "slug", "description", "brand", "sku", "categoryId", "price", "compareAt", "stock"] as const;

export function parseProductForm(formData: FormData) {
  return parseForm(productSchema, {
    ...formStrings(formData, FIELDS),
    isActive: checked(formData, "isActive"),
    isFeatured: checked(formData, "isFeatured"),
  });
}
