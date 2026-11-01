import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { carts, cartItems } from "@/db/schema";
import { unitPriceCents } from "@/lib/catalog-rules";

/** Cookie do carrinho de visitante (não logado). Aponta para carts.session_token. */
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
  /** Falso se o produto saiu de venda depois de entrar no carrinho. */
  available: boolean;
};

export type Cart = {
  id: string;
  lines: CartLine[];
  count: number;
  /** Só dos itens à venda — o que o checkout cobraria. */
  subtotalCents: number;
  /** Há item fora de venda: o checkout não fecha até ele sair do carrinho. */
  hasUnavailable: boolean;
};

/**
 * Carrinho completo (itens + produto/variante) do visitante atual, com o
 * preço ATUAL do catálogo — o mesmo que o checkout cobra.
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
            columns: { id: true, name: true, slug: true, stockQuantity: true, priceCents: true, isActive: true },
            with: {
              images: { orderBy: (i, { asc }) => [asc(i.position)] },
            },
          },
          variant: {
            columns: { id: true, name: true, stockQuantity: true, priceCents: true },
          },
        },
      },
    },
  });
  if (!cart) return null;

  const lines: CartLine[] = cart.items.map((it) => {
    const img = it.product.images[0];
    const stock = it.variant ? it.variant.stockQuantity : it.product.stockQuantity;
    const price = unitPriceCents(it.product.priceCents, it.variant?.priceCents);
    return {
      itemId: it.id,
      productId: it.productId,
      variantId: it.variantId,
      name: it.product.name,
      variantName: it.variant?.name ?? null,
      slug: it.product.slug,
      imageUrl: img?.url ?? null,
      imageAlt: img?.altText ?? null,
      unitPriceCents: price,
      quantity: it.quantity,
      stock,
      lineTotalCents: price * it.quantity,
      available: it.product.isActive,
    };
  });

  return {
    id: cart.id,
    lines,
    count: lines.reduce((n, l) => n + l.quantity, 0),
    subtotalCents: lines.filter((l) => l.available).reduce((s, l) => s + l.lineTotalCents, 0),
    hasUnavailable: lines.some((l) => !l.available),
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
