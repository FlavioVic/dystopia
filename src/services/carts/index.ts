/**
 * Serviço de carrinho — responsabilidade única: esvaziar e restaurar itens.
 *
 * O `restoreCart` é a compensação: se o pedido for cancelado depois de o
 * carrinho ter sido esvaziado, o cliente recebe os itens de volta em vez de
 * ter que montar tudo outra vez.
 */

import { eq } from "drizzle-orm";
import type { Executor } from "@/db";
import { cartItems } from "@/db/schema";

export type CartLineSnapshot = {
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPriceCents: number;
};

export async function clearCart(executor: Executor, cartId: string): Promise<{ removed: number }> {
  const removed = await executor
    .delete(cartItems)
    .where(eq(cartItems.cartId, cartId))
    .returning({ id: cartItems.id });
  return { removed: removed.length };
}

/** Compensação de `clearCart`. */
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
