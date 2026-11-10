"use server";

/**
 * Server Actions de avaliação. Borda HTTP: exige sessão, valida o formulário
 * e delega para o serviço. A regra (uma avaliação por pessoa, compra verificada,
 * agregado do produto) mora em `@/services/reviews`. A conta demo não avalia:
 * a senha dela é pública, e o que ela escrevesse apareceria na loja como se
 * fosse de um cliente.
 */

import { refresh } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";
import { limitAction } from "@/lib/action-limits";
import { getCurrentUser } from "@/lib/data/auth";
import { isDemoAccount } from "@/lib/site";
import { isUuid } from "@/lib/validation/action-input";
import { parseReviewForm } from "@/lib/validation/review";
import { deleteReview as removeReview, upsertReview } from "@/services/reviews";

const DEMO_REVIEW_MESSAGE =
  "A conta de demonstração não publica avaliações: o texto sairia em nome de todos os visitantes.";

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
  if (!user) return { requiresAuth: true, message: "Entre na sua conta para avaliar." };
  if (isDemoAccount(user.email)) return { message: DEMO_REVIEW_MESSAGE };

  const productId = String(formData.get("productId") ?? "");
  if (!isUuid(productId)) return { message: "Produto não encontrado." };
  const product = await db.query.products.findFirst({
    where: eq(products.id, productId),
    columns: { id: true },
  });
  if (!product) return { message: "Produto não encontrado." };

  const parsed = parseReviewForm(formData);
  if (!parsed.ok) return { errors: parsed.errors };
  const { values } = parsed;

  const limited = await limitAction("review", `user:${user.id}`);
  if (limited) return { message: limited };

  await upsertReview(db, {
    productId: product.id,
    userId: user.id,
    rating: values.rating,
    title: values.title,
    comment: values.comment,
  });

  refresh();
  return { ok: true, message: "Relatório registrado." };
}

export async function deleteOwnReview(productId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autorizado." };
  if (isDemoAccount(user.email)) return { ok: false, error: DEMO_REVIEW_MESSAGE };
  if (!isUuid(productId)) return { ok: false, error: "Você ainda não avaliou este produto." };

  const { deleted } = await removeReview(db, user.id, productId);
  if (!deleted) return { ok: false, error: "Você ainda não avaliou este produto." };

  refresh();
  return { ok: true };
}
