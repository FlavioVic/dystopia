"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { carts, cartItems, products, productVariants } from "@/db/schema";
import { CART_COOKIE } from "@/lib/data/cart";

const MAX_PER_ITEM = 10;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 dias

export type CartActionResult = { ok: boolean; error?: string; count?: number };

/** Acha o carrinho do cookie atual ou cria um novo (setando o cookie). */
async function getOrCreateCart() {
  const store = await cookies();
  const token = store.get(CART_COOKIE)?.value;

  if (token) {
    const existing = await db.query.carts.findFirst({
      where: eq(carts.sessionToken, token),
      columns: { id: true },
    });
    if (existing) return existing;
  }

  const newToken = crypto.randomUUID();
  const [created] = await db
    .insert(carts)
    .values({ sessionToken: newToken })
    .returning({ id: carts.id });

  store.set(CART_COOKIE, newToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return created;
}

async function countCart(cartId: string): Promise<number> {
  const rows = await db
    .select({ q: cartItems.quantity })
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId));
  return rows.reduce((n, r) => n + r.q, 0);
}

/** Valida que o item pertence ao carrinho do visitante atual (authz por sessão). */
async function ownedItem(itemId: string) {
  const token = (await cookies()).get(CART_COOKIE)?.value;
  if (!token) return null;
  const item = await db.query.cartItems.findFirst({
    where: eq(cartItems.id, itemId),
    with: {
      cart: { columns: { id: true, sessionToken: true } },
      product: { columns: { stockQuantity: true } },
      variant: { columns: { stockQuantity: true } },
    },
  });
  if (!item || item.cart.sessionToken !== token) return null;
  return item;
}

export async function addToCart(input: {
  productId: string;
  variantId?: string | null;
  quantity?: number;
}): Promise<CartActionResult> {
  const qty = Math.max(1, Math.min(Math.floor(input.quantity ?? 1), MAX_PER_ITEM));
  const variantId = input.variantId ?? null;

  const product = await db.query.products.findFirst({
    where: and(eq(products.id, input.productId), eq(products.isActive, true)),
    columns: { id: true, priceCents: true, stockQuantity: true },
  });
  if (!product) return { ok: false, error: "Produto indisponível." };

  let unitPriceCents = product.priceCents;
  let stock = product.stockQuantity;

  if (variantId) {
    const variant = await db.query.productVariants.findFirst({
      where: and(
        eq(productVariants.id, variantId),
        eq(productVariants.productId, product.id),
      ),
      columns: { id: true, priceCents: true, stockQuantity: true },
    });
    if (!variant) return { ok: false, error: "Variação indisponível." };
    unitPriceCents = variant.priceCents ?? product.priceCents;
    stock = variant.stockQuantity;
  }

  if (stock <= 0) return { ok: false, error: "Produto esgotado." };

  const cart = await getOrCreateCart();

  // OBS: o índice único (cart_id, product_id, variant_id) não pega variant_id NULL
  // no Postgres, então fazemos o upsert manualmente com match null-aware.
  const existing = await db.query.cartItems.findFirst({
    where: and(
      eq(cartItems.cartId, cart.id),
      eq(cartItems.productId, product.id),
      variantId ? eq(cartItems.variantId, variantId) : isNull(cartItems.variantId),
    ),
    columns: { id: true, quantity: true },
  });

  const targetQty = Math.min((existing?.quantity ?? 0) + qty, stock, MAX_PER_ITEM);

  if (existing) {
    await db
      .update(cartItems)
      .set({ quantity: targetQty })
      .where(eq(cartItems.id, existing.id));
  } else {
    await db.insert(cartItems).values({
      cartId: cart.id,
      productId: product.id,
      variantId,
      quantity: targetQty,
      unitPriceCents,
    });
  }

  refresh();
  return { ok: true, count: await countCart(cart.id) };
}

export async function updateCartItemQuantity(
  itemId: string,
  quantity: number,
): Promise<CartActionResult> {
  const item = await ownedItem(itemId);
  if (!item) return { ok: false, error: "Item não encontrado." };

  const stock = item.variant ? item.variant.stockQuantity : item.product.stockQuantity;
  const q = Math.min(Math.max(0, Math.floor(quantity)), stock, MAX_PER_ITEM);

  if (q <= 0) {
    await db.delete(cartItems).where(eq(cartItems.id, item.id));
  } else {
    await db.update(cartItems).set({ quantity: q }).where(eq(cartItems.id, item.id));
  }

  refresh();
  return { ok: true, count: await countCart(item.cartId) };
}

export async function removeCartItem(itemId: string): Promise<CartActionResult> {
  const item = await ownedItem(itemId);
  if (!item) return { ok: false, error: "Item não encontrado." };

  await db.delete(cartItems).where(eq(cartItems.id, item.id));

  refresh();
  return { ok: true, count: await countCart(item.cartId) };
}
