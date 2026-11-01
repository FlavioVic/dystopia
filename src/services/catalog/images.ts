/**
 * Galeria do produto: a ordem é a `position` (0 = foto principal, a que vai
 * no card e no topo da página). Toda mudança reescreve as posições como
 * 0..n-1 numa transação, então não sobra buraco nem empate.
 *
 * O arquivo em si não é assunto daqui: quem grava e apaga no armazenamento é a
 * borda (`lib/media-storage.ts`); o serviço só guarda a URL.
 */

import { asc, eq } from "drizzle-orm";
import type { Executor } from "@/db";
import { productImages, products } from "@/db/schema";
import { MAX_PRODUCT_IMAGES } from "@/lib/product-media";
import { PermanentError } from "@/shared/errors";

export { MAX_PRODUCT_IMAGES };

export const MAX_ALT_TEXT = 160;

export type ProductImage = { id: string; url: string; altText: string | null; position: number };

function cleanAlt(altText: string | null | undefined): string | null {
  const text = altText?.trim().slice(0, MAX_ALT_TEXT) ?? "";
  return text === "" ? null : text;
}

export async function listProductImages(executor: Executor, productId: string): Promise<ProductImage[]> {
  return executor
    .select({ id: productImages.id, url: productImages.url, altText: productImages.altText, position: productImages.position })
    .from(productImages)
    .where(eq(productImages.productId, productId))
    .orderBy(asc(productImages.position), asc(productImages.id));
}

/**
 * Foto nova entra no fim da galeria (a principal só muda quando o admin pede).
 * A linha do produto fica travada até o fim: dois envios ao mesmo tempo com 9
 * fotos não passam os dois do limite.
 */
export async function addProductImage(
  executor: Executor,
  productId: string,
  input: { url: string; altText?: string | null },
): Promise<ProductImage> {
  return executor.transaction(async (tx) => {
    const [product] = await tx.select({ id: products.id }).from(products).where(eq(products.id, productId)).for("update");
    if (!product) throw new PermanentError("product_not_found", "Produto não encontrado.");
    const current = await listProductImages(tx, productId);
    if (current.length >= MAX_PRODUCT_IMAGES) {
      throw new PermanentError("too_many_images", `Limite de ${MAX_PRODUCT_IMAGES} fotos por produto. Remova uma antes de enviar outra.`);
    }
    const [created] = await tx
      .insert(productImages)
      .values({ productId, url: input.url, altText: cleanAlt(input.altText), position: current.length })
      .returning({ id: productImages.id, url: productImages.url, altText: productImages.altText, position: productImages.position });
    return created;
  });
}

export async function updateProductImageAlt(executor: Executor, imageId: string, altText: string): Promise<boolean> {
  const updated = await executor
    .update(productImages)
    .set({ altText: cleanAlt(altText) })
    .where(eq(productImages.id, imageId))
    .returning({ id: productImages.id });
  return updated.length > 0;
}

export type ImageMove = "first" | "up" | "down";

/** Reordena e devolve a nova ordem; `false` se a foto não existe. */
export async function moveProductImage(executor: Executor, imageId: string, move: ImageMove): Promise<boolean> {
  return executor.transaction(async (tx) => {
    const image = await tx.query.productImages.findFirst({ where: eq(productImages.id, imageId), columns: { productId: true } });
    if (!image) return false;
    const order = (await listProductImages(tx, image.productId)).map((i) => i.id);
    const from = order.indexOf(imageId);
    const to = move === "first" ? 0 : move === "up" ? Math.max(0, from - 1) : Math.min(order.length - 1, from + 1);
    order.splice(to, 0, ...order.splice(from, 1));
    await renumber(tx, order);
    return true;
  });
}

/** Tira a foto da galeria e devolve a URL (para a borda apagar o arquivo), ou `null`. */
export async function removeProductImage(executor: Executor, imageId: string): Promise<{ url: string } | null> {
  return executor.transaction(async (tx) => {
    const [removed] = await tx
      .delete(productImages)
      .where(eq(productImages.id, imageId))
      .returning({ url: productImages.url, productId: productImages.productId });
    if (!removed) return null;
    await renumber(tx, (await listProductImages(tx, removed.productId)).map((i) => i.id));
    return { url: removed.url };
  });
}

async function renumber(executor: Executor, orderedIds: string[]): Promise<void> {
  for (const [position, id] of orderedIds.entries()) {
    await executor.update(productImages).set({ position }).where(eq(productImages.id, id));
  }
}
