/**
 * Serviço de notificação — responsabilidade única: avisar por e-mail (o
 * cliente, na confirmação do pedido; o responsável técnico, a cada pedido de
 * orçamento).
 *
 * Em duas metades, por causa do outbox:
 * 1. aqui, dentro da transação do passo da saga: grava a notificação
 *    (`pending`) e enfileira a entrega — idempotente por `dedupe_key`,
 *    reexecutar o passo não cria outra;
 * 2. `delivery.ts`, numa mensagem à parte: manda pelo provedor (Resend) e marca
 *    o resultado. O e-mail nunca sai de dentro da transação do passo.
 */

import { eq } from "drizzle-orm";
import type { Executor } from "@/db";
import { notifications } from "@/db/schema";
import { enqueue } from "@/queue";
import { orderConfirmationEmail, serviceRequestAlertEmail } from "./templates";

/** Fila das entregas de e-mail. */
export const NOTIFICATIONS_QUEUE = "notifications";
export const NOTIFICATION_DELIVER = "notifications.deliver";
/** Tentativas de entrega antes da DLQ (que tem alerta no admin). */
export const DELIVERY_MAX_ATTEMPTS = 5;

export type OrderConfirmationInput = {
  orderNumber: string;
  recipient: string;
  customerName: string;
  totalCents: number;
  paymentMethod?: string;
  items: Array<{ name: string; quantity: number; unitPriceCents?: number }>;
};

export function orderConfirmationDedupeKey(orderNumber: string): string {
  return `order-confirmation:${orderNumber}`;
}

export async function sendOrderConfirmation(
  executor: Executor,
  input: OrderConfirmationInput,
): Promise<{ notificationId: string; duplicate: boolean }> {
  const email = orderConfirmationEmail(input);
  return record(executor, {
    recipient: input.recipient,
    subject: email.subject,
    body: email.text,
    html: email.html,
    correlationId: input.orderNumber,
    dedupeKey: orderConfirmationDedupeKey(input.orderNumber),
  });
}

export type ServiceRequestAlertInput = {
  recipient: string;
  protocol: string;
  serviceName: string;
  name: string;
  email: string;
  phone: string | null;
  details: string;
};

/**
 * Alerta de orçamento novo para o responsável técnico. Chamado na MESMA
 * transação que grava o pedido (outbox): pedido gravado ⇔ alerta na fila.
 */
export async function sendServiceRequestAlert(
  executor: Executor,
  input: ServiceRequestAlertInput,
): Promise<{ notificationId: string; duplicate: boolean }> {
  const email = serviceRequestAlertEmail(input);
  return record(executor, {
    recipient: input.recipient,
    subject: email.subject,
    body: email.text,
    html: email.html,
    correlationId: input.protocol,
    dedupeKey: `service-request-alert:${input.protocol}`,
  });
}

/** Grava a notificação (idempotente por dedupe_key) e enfileira a entrega. */
async function record(
  executor: Executor,
  n: { recipient: string; subject: string; body: string; html: string; correlationId: string; dedupeKey: string },
): Promise<{ notificationId: string; duplicate: boolean }> {
  const inserted = await executor
    .insert(notifications)
    .values({ channel: "email", ...n })
    .onConflictDoNothing()
    .returning({ id: notifications.id });

  if (inserted[0]) {
    await enqueue(executor, {
      type: NOTIFICATION_DELIVER,
      queue: NOTIFICATIONS_QUEUE,
      payload: { notificationId: inserted[0].id },
      maxAttempts: DELIVERY_MAX_ATTEMPTS,
    });
    return { notificationId: inserted[0].id, duplicate: false };
  }

  const existing = await executor.query.notifications.findFirst({
    where: eq(notifications.dedupeKey, n.dedupeKey),
  });
  return { notificationId: existing?.id ?? "", duplicate: true };
}
