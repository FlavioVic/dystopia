/**
 * Serviço de notificação — responsabilidade única: avisar o cliente.
 *
 * Não existe provedor de e-mail aqui: a "entrega" é uma linha em
 * `notifications` (que o painel admin mostra). O ponto arquitetural é a
 * idempotência por `dedupe_key` — reexecutar o passo não manda dois e-mails.
 */

import { eq } from "drizzle-orm";
import type { Executor } from "@/db";
import { notifications } from "@/db/schema";
import { formatPriceCents } from "@/lib/format";

export type OrderConfirmationInput = {
  orderNumber: string;
  recipient: string;
  customerName: string;
  totalCents: number;
  items: Array<{ name: string; quantity: number }>;
};

export function orderConfirmationDedupeKey(orderNumber: string): string {
  return `order-confirmation:${orderNumber}`;
}

export async function sendOrderConfirmation(
  executor: Executor,
  input: OrderConfirmationInput,
): Promise<{ notificationId: string; duplicate: boolean }> {
  const dedupeKey = orderConfirmationDedupeKey(input.orderNumber);
  const subject = `Pedido ${input.orderNumber} confirmado`;
  const body = [
    `Olá, ${input.customerName}!`,
    "",
    `Seu pedido ${input.orderNumber} foi confirmado.`,
    ...input.items.map((item) => `- ${item.quantity}x ${item.name}`),
    "",
    `Total: ${formatPriceCents(input.totalCents)}`,
  ].join("\n");

  const inserted = await executor
    .insert(notifications)
    .values({
      channel: "email",
      recipient: input.recipient,
      subject,
      body,
      correlationId: input.orderNumber,
      dedupeKey,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });

  if (inserted[0]) return { notificationId: inserted[0].id, duplicate: false };

  const existing = await executor.query.notifications.findFirst({
    where: eq(notifications.dedupeKey, dedupeKey),
  });
  return { notificationId: existing?.id ?? "", duplicate: true };
}
