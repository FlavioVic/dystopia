/**
 * Consumidor dos comandos de pagamento — a "borda" do serviço quando ele roda
 * como processo próprio (`npm run worker:payments`, fila `payments`).
 *
 * Cada comando roda numa transação que grava o efeito E a resposta (outbox):
 * não existe cobrança sem aviso pra quem pediu, nem aviso sem cobrança.
 *
 * Retry é daqui agora: falha transitória volta pra fila com backoff (o job
 * conta as tentativas). Esgotou, responde com falha — quem pediu não pode
 * ficar esperando pra sempre por um comando que morreu na dead-letter.
 */

import { db, type Transaction } from "@/db";
import type { ClaimedJob } from "@/queue";
import { readReplyTo, sendReply, type ReplyTo } from "@/queue/reply";
import { errorCode, errorMessage, isRetryable, PermanentError } from "@/saga/errors";
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

type Handler = (job: ClaimedJob) => Promise<{ settled: boolean }>;

/** Handlers que o processo de pagamentos registra no worker. */
export const paymentHandlers: Record<string, Handler> = {
  [PAYMENT_AUTHORIZE]: (job) =>
    handle(job, parseAuthorize, async (tx, command): Promise<AuthorizeReply> => {
      const result = await authorizePayment(tx, { ...command, attempt: job.attempts });
      return { paymentId: result.paymentId, transactionId: result.transactionId };
    }),
  [PAYMENT_REFUND]: (job) =>
    handle(job, parseRefund, async (tx, command): Promise<RefundReply> => refundPayment(tx, command)),
};

async function handle<TCommand, TReply extends Record<string, unknown>>(
  job: ClaimedJob,
  parse: (payload: Record<string, unknown>) => TCommand,
  run: (tx: Transaction, command: TCommand) => Promise<TReply>,
): Promise<{ settled: boolean }> {
  const replyTo = readReplyTo(job.payload);
  // Sem endereço não há a quem responder: erro de quem montou o comando.
  // Lança pra fila — esgota as tentativas e vai pra dead-letter (alerta).
  if (!replyTo) throw new Error(`comando ${job.type} sem replyTo`);

  try {
    const command = parse(job.payload);
    await db.transaction(async (tx) => {
      const output = await run(tx, command);
      await sendReply(tx, replyTo, { ok: true, output, attempts: job.attempts });
    });
  } catch (error) {
    if (isRetryable(error) && job.attempts < job.maxAttempts) throw error;
    await replyFailure(replyTo, job, error);
  }
  return { settled: false };
}

async function replyFailure(replyTo: ReplyTo, job: ClaimedJob, error: unknown): Promise<void> {
  await sendReply(db, replyTo, {
    ok: false,
    code: errorCode(error),
    message: errorMessage(error),
    attempts: job.attempts,
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
