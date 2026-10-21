import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { carts, cartItems } from "@/db/schema";

/** Cookie do carrinho de visitante (não logado). Aponta pra carts.session_token. */
export const CART_COOKIE = "cart_session";

export async function getCartToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(CART_COOKIE)?.value ?? null;
}

export type CartLine = {
  itemId: string;
  productId: string;
  variantId: string | null;
  name: string;
  variantName: string | null;
  slug: string;
  imageUrl: string | null;
  imageAlt: string | null;
  unitPriceCents: number;
  quantity: number;
  stock: number;
  lineTotalCents: number;
};

export type Cart = {
  id: string;
  lines: CartLine[];
  count: number;
  subtotalCents: number;
};

/**
 * Carrinho completo (itens + produto/variante) do visitante atual.
 * Retorna null quando ainda não existe carrinho (sem cookie / sem registro).
 */
export async function getCart(): Promise<Cart | null> {
  const token = await getCartToken();
  if (!token) return null;

  const cart = await db.query.carts.findFirst({
    where: eq(carts.sessionToken, token),
    with: {
      items: {
        orderBy: (ci, { asc }) => [asc(ci.createdAt)],
        with: {
          product: {
            columns: { id: true, name: true, slug: true, stockQuantity: true },
            with: {
              images: { orderBy: (i, { asc }) => [asc(i.position)] },
            },
          },
          variant: {
            columns: { id: true, name: true, stockQuantity: true },
          },
        },
      },
    },
  });
  if (!cart) return null;

  const lines: CartLine[] = cart.items.map((it) => {
    const img = it.product.images[0];
    const stock = it.variant ? it.variant.stockQuantity : it.product.stockQuantity;
    return {
      itemId: it.id,
      productId: it.productId,
      variantId: it.variantId,
      name: it.product.name,
      variantName: it.variant?.name ?? null,
      slug: it.product.slug,
      imageUrl: img?.url ?? null,
      imageAlt: img?.altText ?? null,
      unitPriceCents: it.unitPriceCents,
      quantity: it.quantity,
      stock,
      lineTotalCents: it.unitPriceCents * it.quantity,
    };
  });

  return {
    id: cart.id,
    lines,
    count: lines.reduce((n, l) => n + l.quantity, 0),
    subtotalCents: lines.reduce((s, l) => s + l.lineTotalCents, 0),
  };
}

/** Só o total de unidades — usado pelo badge do header (query enxuta). */
export async function getCartCount(): Promise<number> {
  const token = await getCartToken();
  if (!token) return 0;
  const rows = await db
    .select({ q: cartItems.quantity })
    .from(cartItems)
    .innerJoin(carts, eq(cartItems.cartId, carts.id))
    .where(eq(carts.sessionToken, token));
  return rows.reduce((n, r) => n + r.q, 0);
}
