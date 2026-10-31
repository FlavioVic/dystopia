/**
 * Consumidor dos comandos de pagamento — a "borda" do serviço quando ele roda
 * como processo próprio (`npm run worker:payments`, fila `payments`).
 *
 * Cada comando roda numa transação que grava o efeito E a resposta (outbox):
 * não existe cobrança sem aviso para quem pediu, nem aviso sem cobrança.
 *
 * Retry é daqui: falha transitória (gateway fora, timeout) é relançada e a
 * fila devolve o comando pela fila de espera com backoff, contando a
 * tentativa. Na ÚLTIMA tentativa não relança: responde com falha — quem pediu
 * não pode ficar esperando para sempre por um comando que morreu na DLQ.
 * Reentrega do mesmo comando é segura: `idempotency_key` no banco e no Stripe.
 */

import { db, type Transaction } from "@/db";
import type { MessageHandler, QueueMessage } from "@/queue";
import { readReplyTo, sendReply, type ReplyTo } from "@/queue/reply";
import { errorCode, errorMessage, isRetryable, PermanentError } from "@/shared/errors";
import {
  isCardPaymentMethodId,
  isPaymentMethod,
  isSimulationMode,
  PAYMENT_AUTHORIZE,
  PAYMENT_REFUND,
  type AuthorizeCommand,
  type AuthorizeReply,
  type RefundCommand,
  type RefundReply,
} from "./contract";
import { cardProvider } from "./gateway";
import { authorizePayment, refundPayment } from "./index";

export { cardProvider };

/** Handlers que o processo de pagamentos registra no worker. */
export const paymentHandlers: Record<string, MessageHandler> = {
  [PAYMENT_AUTHORIZE]: (message) =>
    handle(message, parseAuthorize, async (tx, command): Promise<AuthorizeReply> => {
      const result = await authorizePayment(tx, { ...command, attempt: message.attempt });
      return { paymentId: result.paymentId, transactionId: result.transactionId };
    }),
  [PAYMENT_REFUND]: (message) =>
    handle(message, parseRefund, async (tx, command): Promise<RefundReply> => refundPayment(tx, command)),
};

async function handle<TCommand, TReply extends Record<string, unknown>>(
  message: QueueMessage,
  parse: (payload: Record<string, unknown>) => TCommand,
  run: (tx: Transaction, command: TCommand) => Promise<TReply>,
): Promise<void> {
  const replyTo = readReplyTo(message.payload);
  // Sem endereço não há a quem responder: erro de quem montou o comando, que
  // retry não conserta — direto para DLQ (alerta no painel).
  if (!replyTo) throw new PermanentError("invalid_command", `comando ${message.type} sem replyTo`);

  try {
    const command = parse(message.payload);
    await db.transaction(async (tx) => {
      const output = await run(tx, command);
      await sendReply(tx, replyTo, { ok: true, output, attempts: message.attempt });
    });
  } catch (error) {
    if (isRetryable(error) && message.attempt < message.maxAttempts) throw error;
    await replyFailure(replyTo, message, error);
  }
}

async function replyFailure(replyTo: ReplyTo, message: QueueMessage, error: unknown): Promise<void> {
  await sendReply(db, replyTo, {
    ok: false,
    code: errorCode(error),
    message: errorMessage(error),
    attempts: message.attempt,
  });
}

// ---------------------------------------------------------------------------
// Validação dos comandos (o payload vem do banco, sem tipo em runtime)
// ---------------------------------------------------------------------------

function invalid(type: string, field: string): PermanentError {
  return new PermanentError("invalid_command", `Comando ${type} inválido: ${field}.`);
}

function parseAuthorize(payload: Record<string, unknown>): AuthorizeCommand {
  const { orderId, method, amountCents, idempotencyKey, mode, cardPaymentMethodId } = payload;
  if (typeof orderId !== "string") throw invalid(PAYMENT_AUTHORIZE, "orderId");
  if (!isPaymentMethod(method)) throw invalid(PAYMENT_AUTHORIZE, "method");
  if (typeof amountCents !== "number" || !Number.isInteger(amountCents)) throw invalid(PAYMENT_AUTHORIZE, "amountCents");
  if (typeof idempotencyKey !== "string") throw invalid(PAYMENT_AUTHORIZE, "idempotencyKey");
  if (cardPaymentMethodId !== undefined && !isCardPaymentMethodId(cardPaymentMethodId)) {
    throw invalid(PAYMENT_AUTHORIZE, "cardPaymentMethodId");
  }
  return {
    orderId,
    method,
    amountCents,
    idempotencyKey,
    ...(isSimulationMode(mode) ? { mode } : {}),
    ...(cardPaymentMethodId ? { cardPaymentMethodId } : {}),
  };
}

function parseRefund(payload: Record<string, unknown>): RefundCommand {
  const { orderId, idempotencyKey } = payload;
  if (typeof orderId !== "string") throw invalid(PAYMENT_REFUND, "orderId");
  if (typeof idempotencyKey !== "string") throw invalid(PAYMENT_REFUND, "idempotencyKey");
  return { orderId, idempotencyKey };
}
