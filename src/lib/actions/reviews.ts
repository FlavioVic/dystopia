"use server";

/**
 * Server Actions de avaliação. Borda HTTP: exige sessão, valida o formulário
 * e delega pro serviço. A regra (uma avaliação por pessoa, compra verificada,
 * agregado do produto) mora em `@/services/reviews`.
 */

import { refresh } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";
import { getCurrentUser } from "@/lib/data/auth";
import { parseReviewForm } from "@/lib/validation/review";
import { deleteReview as removeReview, upsertReview } from "@/services/reviews";

export type ReviewState =
  | {
      errors?: Record<string, string>;
      message?: string;
      ok?: boolean;
      requiresAuth?: boolean;
    }
  | undefined;

export async function submitReview(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const user = await getCurrentUser();
  if (!user) return { requiresAuth: true, message: "Entre na sua conta pra avaliar." };

  const productId = String(formData.get("productId") ?? "");
  const product = await db.query.products.findFirst({
    where: eq(products.id, productId),
    columns: { id: true },
  });
  if (!product) return { message: "Produto não encontrado." };

  const parsed = parseReviewForm(formData);
  if (!parsed.ok) return { errors: parsed.errors };
  const { values } = parsed;

  await db.transaction(async (tx) => {
    await upsertReview(tx, {
      productId: product.id,
      userId: user.id,
      rating: values.rating,
      title: values.title,
      comment: values.comment,
    });
  });

  refresh();
  return { ok: true, message: "Relatório registrado." };
}

export async function deleteOwnReview(productId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autorizado." };

  const { deleted } = await db.transaction(async (tx) => removeReview(tx, user.id, productId));
  if (!deleted) return { ok: false, error: "Você ainda não avaliou este produto." };

  refresh();
  return { ok: true };
}
