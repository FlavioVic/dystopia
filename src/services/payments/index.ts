/**
 * Serviço de pagamento — responsabilidade única: autorizar e estornar.
 *
 * Idempotência em duas camadas:
 * 1. `payments.idempotency_key` tem unique index + `ON CONFLICT DO NOTHING`,
 *    então reexecutar o passo nunca cria uma segunda cobrança;
 * 2. o provedor recebe a mesma chave e devolve a mesma transação.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { Executor } from "@/db";
import { payments } from "@/db/schema";
import { PermanentError } from "@/saga/errors";
import type { PaymentMethod, SimulationMode } from "./contract";
import { charge, PROVIDER, reverse } from "./gateway";

export type AuthorizeInput = {
  orderId: string;
  method: PaymentMethod;
  amountCents: number;
  idempotencyKey: string;
  mode?: SimulationMode;
  attempt?: number;
  /** Cartão digitado no Stripe Elements (`pm_…`). Ausente = provedor simulado. */
  cardPaymentMethodId?: string;
};

export type AuthorizeResult = {
  paymentId: string;
  transactionId: string;
  reused: boolean;
};

export async function authorizePayment(executor: Executor, input: AuthorizeInput): Promise<AuthorizeResult> {
  const existing = await executor.query.payments.findFirst({
    where: eq(payments.idempotencyKey, input.idempotencyKey),
  });
  if (existing) {
    return { paymentId: existing.id, transactionId: existing.transactionId ?? "", reused: true };
  }

  const result = await charge({
    amountCents: input.amountCents,
    method: input.method,
    idempotencyKey: input.idempotencyKey,
    mode: input.mode,
    attempt: input.attempt,
    cardPaymentMethodId: input.cardPaymentMethodId,
    orderId: input.orderId,
  });

  const inserted = await executor
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
    .returning({ id: payments.id });

  if (inserted[0]) {
    return { paymentId: inserted[0].id, transactionId: result.transactionId, reused: false };
  }

  // Corrida: outra execução gravou a mesma chave primeiro.
  const concurrent = await executor.query.payments.findFirst({
    where: eq(payments.idempotencyKey, input.idempotencyKey),
  });
  if (!concurrent) {
    throw new PermanentError("payment_conflict", "Não foi possível registrar o pagamento.", {
      idempotencyKey: input.idempotencyKey,
    });
  }
  return { paymentId: concurrent.id, transactionId: concurrent.transactionId ?? "", reused: true };
}

/** Compensação de `authorizePayment`: estorna o que foi cobrado. */
export async function refundPayment(
  executor: Executor,
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

export { PROVIDER };
