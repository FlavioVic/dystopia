/**
 * Serviço de carrinho — o carrinho do visitante (por token de cookie) e o
 * que a saga faz com ele: esvaziar no checkout e restaurar na compensação.
 *
 * Toda escrita que depende do estado atual é UMA instrução no banco (upsert
 * ou UPDATE condicional), nunca "lê, decide, escreve": dois cliques
 * simultâneos em "adicionar" somam certo e não duplicam a linha.
 *
 * Posse: as operações num item recebem o `cartId` do dono e filtram por ele
 * no próprio WHERE — item de outro carrinho simplesmente não é encontrado.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { cartItems, carts, products, productVariants } from "@/db/schema";
import { PermanentError } from "@/saga/errors";

/** Teto por linha do carrinho (além do estoque). */
export const MAX_PER_ITEM = 10;

export type CartLineSnapshot = {
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPriceCents: number;
};

export async function findCartIdByToken(executor: Executor, token: string): Promise<string | null> {
  const cart = await executor.query.carts.findFirst({
    where: eq(carts.sessionToken, token),
    columns: { id: true },
  });
  return cart?.id ?? null;
}

export async function createGuestCart(executor: Executor, token: string): Promise<string> {
  const [cart] = await executor.insert(carts).values({ sessionToken: token }).returning({ id: carts.id });
  return cart.id;
}

/** Ao autenticar, o carrinho de visitante passa a ser do usuário. */
export async function claimGuestCart(executor: Executor, token: string, userId: string): Promise<void> {
  await executor.update(carts).set({ userId }).where(eq(carts.sessionToken, token));
}

/**
 * Adiciona `quantity` unidades (somando ao que já houver), limitado ao
 * estoque e a `MAX_PER_ITEM`. Preço é o atual do produto/variante — o
 * carrinho guarda o snapshot, o checkout recalcula.
 */
export async function addItem(
  executor: Executor,
  input: { cartId: string; productId: string; variantId: string | null; quantity: number },
): Promise<void> {
  const product = await executor.query.products.findFirst({
    where: and(eq(products.id, input.productId), eq(products.isActive, true)),
    columns: { id: true, priceCents: true, stockQuantity: true },
  });
  if (!product) throw new PermanentError("product_unavailable", "Produto indisponível.");

  let unitPriceCents = product.priceCents;
  let stock = product.stockQuantity;
  if (input.variantId) {
    const variant = await executor.query.productVariants.findFirst({
      where: and(eq(productVariants.id, input.variantId), eq(productVariants.productId, product.id)),
      columns: { priceCents: true, stockQuantity: true },
    });
    if (!variant) throw new PermanentError("variant_unavailable", "Variação indisponível.");
    unitPriceCents = variant.priceCents ?? product.priceCents;
    stock = variant.stockQuantity;
  }
  if (stock <= 0) throw new PermanentError("out_of_stock", "Produto esgotado.");

  const cap = Math.min(stock, MAX_PER_ITEM);
  const quantity = Math.min(Math.max(1, Math.floor(input.quantity)), cap);

  await executor
    .insert(cartItems)
    .values({ cartId: input.cartId, productId: product.id, variantId: input.variantId, quantity, unitPriceCents })
    .onConflictDoUpdate({
      target: [cartItems.cartId, cartItems.productId, cartItems.variantId],
      set: {
        quantity: sql`least(${cartItems.quantity} + excluded.quantity, ${cap})`,
        unitPriceCents: sql`excluded.unit_price_cents`,
      },
    });
}

/**
 * Define a quantidade de um item do carrinho (0 remove), limitada ao estoque
 * atual e a `MAX_PER_ITEM`. Retorna `false` se o item não é deste carrinho.
 */
export async function setItemQuantity(
  executor: Executor,
  input: { cartId: string; itemId: string; quantity: number },
): Promise<boolean> {
  const item = await executor.query.cartItems.findFirst({
    where: and(eq(cartItems.id, input.itemId), eq(cartItems.cartId, input.cartId)),
    columns: { id: true },
    with: { product: { columns: { stockQuantity: true } }, variant: { columns: { stockQuantity: true } } },
  });
  if (!item) return false;

  const stock = item.variant ? item.variant.stockQuantity : item.product.stockQuantity;
  const quantity = Math.min(Math.max(0, Math.floor(input.quantity)), stock, MAX_PER_ITEM);
  if (quantity <= 0) return removeItem(executor, input);

  await executor
    .update(cartItems)
    .set({ quantity })
    .where(and(eq(cartItems.id, input.itemId), eq(cartItems.cartId, input.cartId)));
  return true;
}

/** Retorna `false` se o item não é deste carrinho. */
export async function removeItem(executor: Executor, input: { cartId: string; itemId: string }): Promise<boolean> {
  const removed = await executor
    .delete(cartItems)
    .where(and(eq(cartItems.id, input.itemId), eq(cartItems.cartId, input.cartId)))
    .returning({ id: cartItems.id });
  return removed.length > 0;
}

/** Total de unidades no carrinho (o número do ícone). */
export async function countItems(executor: Executor, cartId: string): Promise<number> {
  const [row] = await executor
    .select({ total: sql<number>`coalesce(sum(${cartItems.quantity}), 0)::int` })
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId));
  return row.total;
}

export async function clearCart(executor: Executor, cartId: string): Promise<{ removed: number }> {
  const removed = await executor
    .delete(cartItems)
    .where(eq(cartItems.cartId, cartId))
    .returning({ id: cartItems.id });
  return { removed: removed.length };
}

/**
 * Compensação de `clearCart`. `DO NOTHING` no conflito de propósito: a
 * compensação pode rodar duas vezes (reentrega), e somar dobraria o carrinho.
 */
export async function restoreCart(
  executor: Executor,
  cartId: string,
  lines: CartLineSnapshot[],
): Promise<{ restored: number }> {
  if (lines.length === 0) return { restored: 0 };
  const restored = await executor
    .insert(cartItems)
    .values(
      lines.map((line) => ({
        cartId,
        productId: line.productId,
        variantId: line.variantId,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: cartItems.id });
  return { restored: restored.length };
}
