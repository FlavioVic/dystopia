/**
 * Caso de uso: o cliente acompanha o próprio pedido.
 *
 * O andamento vem dos **eventos de domínio** do pedido (recebido, pago,
 * enviado, cancelado e por quê) — não do log da saga, que é detalhe interno
 * de como o pedido é orquestrado. Enquanto ele está `pending`, `whilePending`
 * avisa quem chamou: no deploy só-Vercel é o que empurra a fila se o dreno do
 * checkout morreu no meio.
 */

import { db } from "@/db";
import { findCustomerOrder, listOrderEvents } from "@/services/orders";

export async function viewOrder(
  orderNumber: string,
  userId: string,
  hooks: { whilePending?: () => void } = {},
) {
  const order = await findCustomerOrder(db, orderNumber, userId);
  if (!order) return null;

  const events = await listOrderEvents(db, order.id);
  if (order.status === "pending") hooks.whilePending?.();
  return { order, events };
}
