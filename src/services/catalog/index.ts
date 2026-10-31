/**
 * Serviço de catálogo — responsabilidade única: manter produto e variante.
 *
 * Existe para tirar escrita de banco da Server Action do admin: a action vira
 * borda (sessão + validação) e a regra — incluindo traduzir violação de índice
 * único em erro de negócio — fica aqui, testável.
 */

import { and, asc, eq, ne } from "drizzle-orm";
import type { Executor } from "@/db";
import { productImages, productVariants, products } from "@/db/schema";
import { PermanentError } from "@/shared/errors";

export type ProductWriteInput = {
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

export type VariantWriteInput = {
  name: string;
  sku: string;
  priceCents: number | null;
  stockQuantity: number;
  attributes: Record<string, string>;
};

/** Slug e SKU são únicos — a checagem antecipada dá erro explicável. */
async function assertProductUniqueness(
  executor: Executor,
  input: Pick<ProductWriteInput, "slug" | "sku">,
  ignoreProductId?: string,
): Promise<void> {
  const conflicts = await executor.query.products.findMany({
    where: ignoreProductId ? ne(products.id, ignoreProductId) : undefined,
    columns: { slug: true, sku: true },
  });

  if (conflicts.some((product) => product.slug === input.slug)) {
    throw new PermanentError("duplicate_slug", "Já existe produto com esse slug.", { slug: input.slug });
  }
  if (conflicts.some((product) => product.sku === input.sku)) {
    throw new PermanentError("duplicate_sku", "Já existe produto com esse SKU.", { sku: input.sku });
  }
}

export async function createProduct(
  executor: Executor,
  input: ProductWriteInput,
  options: { imageUrl?: string | null } = {},
): Promise<{ productId: string }> {
  await assertProductUniqueness(executor, input);

  const [created] = await executor.insert(products).values(input).returning({ id: products.id });

  if (options.imageUrl) {
    await executor.insert(productImages).values({
      productId: created.id,
      url: options.imageUrl,
      altText: input.name,
      position: 0,
    });
  }

  return { productId: created.id };
}

export async function updateProduct(
  executor: Executor,
  productId: string,
  input: ProductWriteInput,
): Promise<void> {
  await assertProductUniqueness(executor, input, productId);
  await executor
    .update(products)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(products.id, productId));
}

export async function setProductFlag(
  executor: Executor,
  productId: string,
  flag: "isActive" | "isFeatured",
): Promise<{ value: boolean }> {
  const product = await executor.query.products.findFirst({
    where: eq(products.id, productId),
    columns: { isActive: true, isFeatured: true },
  });
  if (!product) throw new PermanentError("product_not_found", "Produto não encontrado.", { productId });

  const value = !product[flag];
  await executor
    .update(products)
    .set(
      flag === "isActive"
        ? { isActive: value, updatedAt: new Date() }
        : { isFeatured: value, updatedAt: new Date() },
    )
    .where(eq(products.id, productId));

  return { value };
}

// ---------------------------------------------------------------------------
// Variantes
// ---------------------------------------------------------------------------

export async function listVariants(executor: Executor, productId: string) {
  return executor.query.productVariants.findMany({
    where: eq(productVariants.productId, productId),
    orderBy: [asc(productVariants.name)],
  });
}

export async function createVariant(
  executor: Executor,
  productId: string,
  input: VariantWriteInput,
): Promise<{ variantId: string }> {
  const product = await executor.query.products.findFirst({
    where: eq(products.id, productId),
    columns: { id: true },
  });
  if (!product) throw new PermanentError("product_not_found", "Produto não encontrado.", { productId });

  await assertVariantSkuFree(executor, input.sku);

  const [created] = await executor
    .insert(productVariants)
    .values({ productId, ...input })
    .returning({ id: productVariants.id });

  return { variantId: created.id };
}

export async function updateVariant(
  executor: Executor,
  variantId: string,
  input: VariantWriteInput,
): Promise<void> {
  const variant = await executor.query.productVariants.findFirst({
    where: eq(productVariants.id, variantId),
    columns: { id: true },
  });
  if (!variant) throw new PermanentError("variant_not_found", "Variante não encontrada.", { variantId });

  await assertVariantSkuFree(executor, input.sku, variantId);
  await executor.update(productVariants).set(input).where(eq(productVariants.id, variantId));
}

export async function deleteVariant(
  executor: Executor,
  variantId: string,
): Promise<{ deleted: boolean }> {
  const removed = await executor
    .delete(productVariants)
    .where(eq(productVariants.id, variantId))
    .returning({ id: productVariants.id });
  return { deleted: removed.length > 0 };
}

async function assertVariantSkuFree(
  executor: Executor,
  sku: string,
  ignoreVariantId?: string,
): Promise<void> {
  const existing = await executor.query.productVariants.findFirst({
    where: ignoreVariantId
      ? and(eq(productVariants.sku, sku), ne(productVariants.id, ignoreVariantId))
      : eq(productVariants.sku, sku),
    columns: { id: true },
  });
  if (existing) {
    throw new PermanentError("duplicate_variant_sku", "Já existe variante com esse SKU.", { sku });
  }
}
export * from "./images";
