/**
 * Serviço de estoque — responsabilidade única: reservar e devolver unidades.
 *
 * `reserveStock` usa UPDATE condicional (`where stock >= quantidade`): se o
 * banco não atualizar a linha, não existe estoque e o passo falha de forma
 * PERMANENTE (compensa, não insiste). Isso corrige o comportamento antigo
 * (`GREATEST(0, stock - q)`), que escondia venda sem estoque.
 */

import { and, eq, gte, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { productVariants, products } from "@/db/schema";
import { PermanentError } from "@/shared/errors";

export type StockLine = {
  productId: string;
  variantId: string | null;
  quantity: number;
};

export type ReserveResult = {
  reserved: Array<{ productId: string; variantId: string | null; quantity: number }>;
};

export async function reserveStock(executor: Executor, lines: StockLine[]): Promise<ReserveResult> {
  const reserved: ReserveResult["reserved"] = [];

  for (const line of lines) {
    if (line.quantity <= 0) {
      throw new PermanentError("invalid_quantity", "Quantidade inválida no pedido.", { line });
    }

    const updated = line.variantId
      ? await executor
          .update(productVariants)
          .set({ stockQuantity: sql`${productVariants.stockQuantity} - ${line.quantity}` })
          .where(
            and(eq(productVariants.id, line.variantId), gte(productVariants.stockQuantity, line.quantity)),
          )
          .returning({ id: productVariants.id })
      : await executor
          .update(products)
          .set({ stockQuantity: sql`${products.stockQuantity} - ${line.quantity}`, updatedAt: new Date() })
          .where(and(eq(products.id, line.productId), gte(products.stockQuantity, line.quantity)))
          .returning({ id: products.id });

    if (updated.length === 0) {
      throw new PermanentError("out_of_stock", "Estoque insuficiente para um dos itens.", {
        productId: line.productId,
        variantId: line.variantId,
        quantity: line.quantity,
      });
    }

    reserved.push({ productId: line.productId, variantId: line.variantId, quantity: line.quantity });
  }

  return { reserved };
}

/** Compensação de `reserveStock`: devolve as unidades. */
export async function releaseStock(executor: Executor, lines: StockLine[]): Promise<void> {
  for (const line of lines) {
    if (line.variantId) {
      await executor
        .update(productVariants)
        .set({ stockQuantity: sql`${productVariants.stockQuantity} + ${line.quantity}` })
        .where(eq(productVariants.id, line.variantId));
    } else {
      await executor
        .update(products)
        .set({ stockQuantity: sql`${products.stockQuantity} + ${line.quantity}`, updatedAt: new Date() })
        .where(eq(products.id, line.productId));
    }
  }
}

/** Estoque disponível de um produto/variante (usado em checagens e testes). */
export async function availableStock(
  executor: Executor,
  line: Pick<StockLine, "productId" | "variantId">,
): Promise<number> {
  if (line.variantId) {
    const variant = await executor.query.productVariants.findFirst({
      where: eq(productVariants.id, line.variantId),
      columns: { stockQuantity: true },
    });
    return variant?.stockQuantity ?? 0;
  }
  const product = await executor.query.products.findFirst({
    where: eq(products.id, line.productId),
    columns: { stockQuantity: true },
  });
  return product?.stockQuantity ?? 0;
}
