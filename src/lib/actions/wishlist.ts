"use server";

/**
 * Server Action da lista de desejos. Visitante não logado recebe
 * `requiresAuth` em vez de erro — o botão usa isso para mandar para o /entrar.
 */

import { refresh } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";
import { limitAction } from "@/lib/action-limits";
import { getCurrentUser } from "@/lib/data/auth";
import { toggleWishlist } from "@/services/wishlist";

export type WishlistResult = {
  ok: boolean;
  inWishlist?: boolean;
  requiresAuth?: boolean;
  error?: string;
};

export async function toggleWishlistItem(productId: string): Promise<WishlistResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, requiresAuth: true };

  const limited = await limitAction("wishlist", `user:${user.id}`);
  if (limited) return { ok: false, error: limited };

  const product = await db.query.products.findFirst({
    where: eq(products.id, productId),
    columns: { id: true },
  });
  if (!product) return { ok: false, error: "Produto não encontrado." };

  const { inWishlist } = await toggleWishlist(db, user.id, product.id);
  refresh();
  return { ok: true, inWishlist };
}
