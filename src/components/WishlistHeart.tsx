import { getCurrentUser } from "@/lib/data/auth";
import { getWishlistProductIds } from "@/lib/data/wishlist";
import { WishlistToggle } from "@/components/WishlistToggle";

/**
 * Embrulho server-side do coração: resolve "está favoritado?" sem obrigar
 * cada página a carregar e repassar a lista. `getCurrentUser` e
 * `getWishlistProductIds` são memoizados por request (React `cache()`), então
 * a vitrine inteira custa uma query — não uma por card.
 */
export async function WishlistHeart({
  productId,
  size = "md",
}: {
  productId: string;
  size?: "sm" | "md";
}) {
  const [user, favorites] = await Promise.all([getCurrentUser(), getWishlistProductIds()]);

  return (
    <WishlistToggle
      productId={productId}
      initial={favorites.has(productId)}
      isLoggedIn={user != null}
      size={size}
    />
  );
}
