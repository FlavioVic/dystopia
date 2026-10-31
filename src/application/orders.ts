/**
 * Caso de uso: o cliente acompanha o próprio pedido.
 *
 * O pedido nasce `pending` e a saga o leva para `paid` (ou `cancelled`). Enquanto
 * ele está em andamento, `whilePending` avisa quem chamou — no deploy
 * só-Vercel é o que empurra a fila se o dreno do checkout morreu no meio.
 */

import { db } from "@/db";
import { getSagaByCorrelationId } from "@/saga/orchestrator";
import { findCustomerOrder } from "@/services/orders";

export async function viewOrder(
  orderNumber: string,
  userId: string,
  hooks: { whilePending?: () => void } = {},
) {
  const order = await findCustomerOrder(db, orderNumber, userId);
  if (!order) return null;

  const saga = await getSagaByCorrelationId(orderNumber);
  if (order.status === "pending") hooks.whilePending?.();
  return { order, saga };
}
