/**
 * Contrato público do serviço de pagamentos — a ÚNICA parte dele que o resto
 * do sistema pode importar (tests/unit/architecture.test.ts garante).
 *
 * Pagamentos roda como processo próprio (`npm run worker:payments`),
 * consumindo a fila `payments` no RabbitMQ. Quem quer cobrar ou estornar manda um comando
 * com endereço de resposta (`replyTo`, ver queue/reply.ts) e recebe o
 * resultado por mensagem — sem importar uma linha da implementação. Trocar a
 * fila por HTTP, ou o processo por outro deploy, não muda quem usa isto aqui.
 */

import { paymentMethodEnum } from "@/db/schema";

export const PAYMENTS_QUEUE = "payments";

/** Comando: autorizar a cobrança. Responde `{ paymentId, transactionId }`. */
export const PAYMENT_AUTHORIZE = "payments.authorize";
/** Comando: estornar. Responde `{ refunded }`. Idempotente. */
export const PAYMENT_REFUND = "payments.refund";

export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && (paymentMethodEnum.enumValues as readonly string[]).includes(value);
}

/**
 * Caminhos do gateway simulado, para demonstrar/testar os caminhos tristes de
 * forma determinística. O padrão é aprovar.
 */
export const SIMULATION_MODES = ["approve", "decline", "flaky_once", "unavailable"] as const;
export type SimulationMode = (typeof SIMULATION_MODES)[number];

export function isSimulationMode(value: unknown): value is SimulationMode {
  return typeof value === "string" && (SIMULATION_MODES as readonly string[]).includes(value);
}

export type AuthorizeCommand = {
  orderId: string;
  method: PaymentMethod;
  amountCents: number;
  /** Mesma chave => mesma cobrança, aqui e no provedor. */
  idempotencyKey: string;
  mode?: SimulationMode;
  /**
   * Cartão: PaymentMethod do Stripe criado no navegador (`pm_…`) — o número do
   * cartão nunca passa pelo nosso servidor. Ausente = Pix/boleto (simulado).
   */
  cardPaymentMethodId?: string;
};

/** Formato de um PaymentMethod do Stripe; o resto é rejeitado na borda. */
export function isCardPaymentMethodId(value: unknown): value is string {
  return typeof value === "string" && /^pm_[A-Za-z0-9_]{6,}$/.test(value);
}

export type RefundCommand = {
  orderId: string;
  idempotencyKey: string;
};

export type AuthorizeReply = { paymentId: string; transactionId: string };
export type RefundReply = { refunded: boolean };
