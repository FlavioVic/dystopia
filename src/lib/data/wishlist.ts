import { cache } from "react";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/data/auth";
import { listWishlist, wishlistProductIds } from "@/services/wishlist";

/**
 * Leituras da lista de desejos pra UI. O `cache()` do React é o que permite o
 * coração aparecer em N cards da vitrine com UMA query por request.
 */

export const getWishlistProductIds = cache(async (): Promise<Set<string>> => {
  const user = await getCurrentUser();
  if (!user) return new Set();
  return new Set(await wishlistProductIds(db, user.id));
});

export const getWishlist = cache(async () => {
  const user = await getCurrentUser();
  if (!user) return [];
  return listWishlist(db, user.id);
});
