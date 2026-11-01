/**
 * Serviço de lista de desejos — responsabilidade única: guardar o que a
 * pessoa quer comprar depois.
 *
 * A tabela tem chave primária composta (`user_id`, `product_id`), então
 * "favoritar" é idempotente por construção: `ON CONFLICT DO NOTHING`.
 */

import { and, desc, eq } from "drizzle-orm";
import type { Executor } from "@/db";
import { wishlistItems } from "@/db/schema";

export async function addToWishlist(
  executor: Executor,
  userId: string,
  productId: string,
): Promise<{ added: boolean }> {
  const inserted = await executor
    .insert(wishlistItems)
    .values({ userId, productId })
    .onConflictDoNothing()
    .returning({ productId: wishlistItems.productId });
  return { added: inserted.length > 0 };
}

export async function removeFromWishlist(
  executor: Executor,
  userId: string,
  productId: string,
): Promise<{ removed: boolean }> {
  const deleted = await executor
    .delete(wishlistItems)
    .where(and(eq(wishlistItems.userId, userId), eq(wishlistItems.productId, productId)))
    .returning({ productId: wishlistItems.productId });
  return { removed: deleted.length > 0 };
}

/** Favorita se não estava, desfavorita se estava. Devolve o estado final. */
export async function toggleWishlist(
  executor: Executor,
  userId: string,
  productId: string,
): Promise<{ inWishlist: boolean }> {
  const { removed } = await removeFromWishlist(executor, userId, productId);
  if (removed) return { inWishlist: false };
  await addToWishlist(executor, userId, productId);
  return { inWishlist: true };
}

export async function isInWishlist(
  executor: Executor,
  userId: string,
  productId: string,
): Promise<boolean> {
  const row = await executor.query.wishlistItems.findFirst({
    where: and(eq(wishlistItems.userId, userId), eq(wishlistItems.productId, productId)),
  });
  return row != null;
}

/** Ids favoritados — uma query só, para marcar o coração na vitrine. */
export async function wishlistProductIds(executor: Executor, userId: string): Promise<string[]> {
  const rows = await executor
    .select({ productId: wishlistItems.productId })
    .from(wishlistItems)
    .where(eq(wishlistItems.userId, userId));
  return rows.map((row) => row.productId);
}

/**
 * Lista completa (com produto e imagens) para a página de favoritos — só o
 * que está à venda. Produto desativado some da lista mas o favorito fica:
 * se ele voltar, volta para a lista também.
 */
export async function listWishlist(executor: Executor, userId: string) {
  const items = await executor.query.wishlistItems.findMany({
    where: eq(wishlistItems.userId, userId),
    orderBy: [desc(wishlistItems.createdAt)],
    with: {
      product: {
        with: { images: { orderBy: (image, { asc }) => [asc(image.position)] } },
      },
    },
  });
  return items.filter((item) => item.product.isActive);
}
