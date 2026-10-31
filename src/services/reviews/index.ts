/**
 * Serviço de avaliações — responsabilidade única: guardar a opinião do
 * cliente e manter o agregado do produto coerente.
 *
 * Duas coisas importam aqui:
 * 1. uma avaliação por (produto, usuário) — reenviar EDITA a sua, não cria
 *    outra (índice único + `onConflictDoUpdate`);
 * 2. `products.rating_average` / `rating_count` são recalculados na MESMA
 *    transação da escrita, senão a vitrine mostra média de um mundo que não
 *    existe mais.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { orderItems, orders, products, reviews } from "@/db/schema";
import { averageRating } from "@/lib/validation/review";

/** Status de pedido que contam como "comprou de verdade". */
const PURCHASED_STATUSES = ["paid", "processing", "shipped", "delivered"] as const;

export type ReviewInput = {
  productId: string;
  userId: string;
  rating: number;
  title: string | null;
  comment: string | null;
};

export async function hasPurchasedProduct(
  executor: Executor,
  userId: string,
  productId: string,
): Promise<boolean> {
  const rows = await executor
    .select({ id: orderItems.id })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(
      and(
        eq(orders.userId, userId),
        eq(orderItems.productId, productId),
        inArray(orders.status, [...PURCHASED_STATUSES]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function getUserReview(executor: Executor, userId: string, productId: string) {
  return executor.query.reviews.findFirst({
    where: and(eq(reviews.userId, userId), eq(reviews.productId, productId)),
  });
}

/**
 * Cria ou atualiza a avaliação do usuário e reescreve o agregado do produto.
 * Os dois commitam juntos (savepoint quando já existe transação em volta).
 */
export async function upsertReview(
  executor: Executor,
  input: ReviewInput,
): Promise<{ reviewId: string; isVerifiedPurchase: boolean }> {
  return executor.transaction(async (tx) => {
    const isVerifiedPurchase = await hasPurchasedProduct(tx, input.userId, input.productId);

    const [row] = await tx
      .insert(reviews)
      .values({
        productId: input.productId,
        userId: input.userId,
        rating: input.rating,
        title: input.title,
        comment: input.comment,
        isVerifiedPurchase,
      })
      .onConflictDoUpdate({
        target: [reviews.productId, reviews.userId],
        set: {
          rating: input.rating,
          title: input.title,
          comment: input.comment,
          isVerifiedPurchase,
          createdAt: new Date(),
        },
      })
      .returning({ id: reviews.id });

    await recalculateProductRating(tx, input.productId);

    return { reviewId: row.id, isVerifiedPurchase };
  });
}

export async function deleteReview(
  executor: Executor,
  userId: string,
  productId: string,
): Promise<{ deleted: boolean }> {
  return executor.transaction(async (tx) => {
    const removed = await tx
      .delete(reviews)
      .where(and(eq(reviews.userId, userId), eq(reviews.productId, productId)))
      .returning({ id: reviews.id });

    if (removed.length > 0) await recalculateProductRating(tx, productId);
    return { deleted: removed.length > 0 };
  });
}

/** Reescreve média e contagem a partir das avaliações existentes. */
export async function recalculateProductRating(
  executor: Executor,
  productId: string,
): Promise<{ average: string; count: number }> {
  const rows = await executor
    .select({ rating: reviews.rating })
    .from(reviews)
    .where(eq(reviews.productId, productId));

  const average = averageRating(rows.map((row) => row.rating));
  const count = rows.length;

  await executor
    .update(products)
    .set({ ratingAverage: average, ratingCount: count, updatedAt: new Date() })
    .where(eq(products.id, productId));

  return { average, count };
}

/** Distribuição de notas (1..5) — usada no resumo da página do produto. */
export async function ratingBreakdown(
  executor: Executor,
  productId: string,
): Promise<Record<number, number>> {
  const rows = await executor
    .select({ rating: reviews.rating, total: sql<number>`count(*)::int` })
    .from(reviews)
    .where(eq(reviews.productId, productId))
    .groupBy(reviews.rating);

  const breakdown: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of rows) breakdown[row.rating] = row.total;
  return breakdown;
}
