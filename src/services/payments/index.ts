/**
 * Serviço de pagamento — responsabilidade única: autorizar, estornar e dizer
 * o que aconteceu com uma cobrança. Os dados são dele (banco próprio,
 * `./db.ts`); quem está de fora só vê o que as respostas do contrato trazem.
 *
 * Idempotência em duas camadas:
 * 1. `payments.idempotency_key` tem unique index + `ON CONFLICT DO NOTHING`,
 *    então reprocessar o comando nunca cria uma segunda cobrança;
 * 2. o provedor recebe a mesma chave e devolve a mesma transação.
 */

import { and, eq, inArray } from "drizzle-orm";
import { PermanentError } from "@/shared/errors";
import type { AuthorizeReply, PaymentMethod, StatusReply } from "./contract";
import type { PaymentsExecutor } from "./db";
import { charge, PROVIDER, reverse } from "./gateway";
import { payments } from "./schema";

export type AuthorizeInput = {
  orderId: string;
  method: PaymentMethod;
  amountCents: number;
  idempotencyKey: string;
  attempt?: number;
  /** Token do meio de pagamento (`pm_…` do Stripe ou token de teste). Ausente = provedor simulado. */
  paymentToken?: string;
};


type PaymentRow = typeof payments.$inferSelect;

/** O que a resposta leva: o resumo que o pedido guarda do lado dele. */
function summary(row: PaymentRow): AuthorizeReply {
  return {
    paymentId: row.id,
    transactionId: row.transactionId ?? "",
    provider: row.provider,
    method: row.method,
    amountCents: row.amountCents,
    paidAt: (row.paidAt ?? row.createdAt).toISOString(),
  };
}

/** Cobra (ou devolve a cobrança que já existe com a mesma chave) e responde o resumo. */
export async function authorizePayment(executor: PaymentsExecutor, input: AuthorizeInput): Promise<AuthorizeReply> {
  const existing = await executor.query.payments.findFirst({
    where: eq(payments.idempotencyKey, input.idempotencyKey),
  });
  if (existing) return summary(existing);

  const result = await charge({
    amountCents: input.amountCents,
    method: input.method,
    idempotencyKey: input.idempotencyKey,
    attempt: input.attempt,
    paymentToken: input.paymentToken,
    orderId: input.orderId,
  });

  const [inserted] = await executor
    .insert(payments)
    .values({
      orderId: input.orderId,
      provider: result.provider,
      method: input.method,
      status: "paid",
      amountCents: input.amountCents,
      transactionId: result.transactionId,
      idempotencyKey: input.idempotencyKey,
      paidAt: result.authorizedAt,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted) return summary(inserted);

  // Corrida: outra execução gravou a mesma chave primeiro.
  const concurrent = await executor.query.payments.findFirst({
    where: eq(payments.idempotencyKey, input.idempotencyKey),
  });
  if (!concurrent) {
    throw new PermanentError("payment_conflict", "Não foi possível registrar o pagamento.", {
      idempotencyKey: input.idempotencyKey,
    });
  }
  return summary(concurrent);
}

/** Compensação de `authorizePayment`: estorna o que foi cobrado. */
export async function refundPayment(
  executor: PaymentsExecutor,
  input: { orderId: string; idempotencyKey?: string },
): Promise<{ refunded: boolean }> {
  const payment = input.idempotencyKey
    ? await executor.query.payments.findFirst({ where: eq(payments.idempotencyKey, input.idempotencyKey) })
    : await executor.query.payments.findFirst({ where: eq(payments.orderId, input.orderId) });

  if (!payment) return { refunded: false };
  if (payment.status === "refunded") return { refunded: true };

  await reverse({
    transactionId: payment.transactionId,
    provider: payment.provider,
    idempotencyKey: payment.idempotencyKey ?? `payment:${payment.id}`,
  });

  const updated = await executor
    .update(payments)
    .set({ status: "refunded" })
    .where(and(eq(payments.id, payment.id), inArray(payments.status, ["authorized", "paid"])))
    .returning({ id: payments.id });

  return { refunded: updated.length > 0 };
}

/** Consulta pela chave de idempotência (comando `payments.status`). Só lê. */
export async function getPaymentStatus(executor: PaymentsExecutor, idempotencyKey: string): Promise<StatusReply> {
  const payment = await executor.query.payments.findFirst({ where: eq(payments.idempotencyKey, idempotencyKey) });
  if (!payment) return { state: "not_found" };
  return { state: payment.status, ...summary(payment) };
}

export { PROVIDER };
