/**
 * Contrato público do serviço de pagamentos — a ÚNICA parte dele que o resto
 * do sistema pode importar (tests/unit/architecture.test.ts garante).
 *
 * Pagamentos roda como processo próprio (`npm run worker:payments`), com
 * banco próprio (`PAYMENTS_DATABASE_URL`), consumindo a fila `payments` no
 * RabbitMQ. Quem quer cobrar, estornar ou consultar manda um comando com
 * endereço de resposta (`replyTo`, ver queue/reply.ts) e recebe o resultado
 * por mensagem — sem importar uma linha da implementação nem ler as tabelas
 * dele. Por isso este arquivo não importa nada: os tipos são do contrato, não
 * do schema de quem quer que seja.
 */

export const PAYMENTS_QUEUE = "payments";

/**
 * Comando: autorizar a cobrança. Responde `AuthorizeReply` — o resumo que
 * quem pediu guarda do lado dele (o pedido), sem precisar ler pagamentos.
 */
export const PAYMENT_AUTHORIZE = "payments.authorize";
/** Comando: estornar. Responde `{ refunded }`. Idempotente. */
export const PAYMENT_REFUND = "payments.refund";
/**
 * Consulta: o que aconteceu com a cobrança desta chave? Responde
 * `StatusReply`. Só lê — é o que quem pediu usa quando a resposta de
 * `authorize`/`refund` não chega no prazo.
 */
export const PAYMENT_STATUS = "payments.status";

export const PAYMENT_METHODS = ["credit_card", "pix", "boleto", "paypal"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && (PAYMENT_METHODS as readonly string[]).includes(value);
}

/**
 * Tokens de teste do provedor simulado — como os cartões de teste do Stripe
 * (4242… aprova, 4000…0002 recusa): não são um campo especial do comando, são
 * valores de `paymentToken` que o provedor simulado entende. Pagamentos só os
 * aceita com o modo demonstração ligado no processo dele.
 */
export const TEST_PAYMENT_TOKENS = {
  approve: "sim_approve",
  decline: "sim_decline",
  flaky_once: "sim_flaky_once",
  unavailable: "sim_unavailable",
} as const;
export type TestPaymentScenario = keyof typeof TEST_PAYMENT_TOKENS;

export function isTestPaymentScenario(value: unknown): value is TestPaymentScenario {
  return typeof value === "string" && Object.hasOwn(TEST_PAYMENT_TOKENS, value);
}

export type AuthorizeCommand = {
  orderId: string;
  method: PaymentMethod;
  amountCents: number;
  /** Mesma chave => mesma cobrança, aqui e no provedor. */
  idempotencyKey: string;
  /**
   * Token opaco do meio de pagamento, de quem processa: `pm_…` (cartão
   * digitado no Stripe Elements — o número nunca passa pelo nosso servidor)
   * ou um token de teste. Ausente = Pix/boleto no provedor simulado.
   */
  paymentToken?: string;
};

/** Formato aceito no `paymentToken` (o provedor confere o resto). */
export function isPaymentToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-z]{2,4}_[A-Za-z0-9_]{4,200}$/.test(value);
}

/** Formato de um PaymentMethod do Stripe (cartão do Elements); o resto é rejeitado na borda. */
export function isCardPaymentMethodId(value: unknown): value is string {
  return typeof value === "string" && /^pm_[A-Za-z0-9_]{6,}$/.test(value);
}

export type RefundCommand = {
  orderId: string;
  idempotencyKey: string;
};

/** Resumo da cobrança aprovada — quem pediu guarda isto (o pedido mostra ao cliente). */
export type AuthorizeReply = {
  paymentId: string;
  transactionId: string;
  provider: string;
  method: PaymentMethod;
  amountCents: number;
  /** ISO 8601. */
  paidAt: string;
};
export type RefundReply = { refunded: boolean };

export type StatusCommand = { idempotencyKey: string };

/**
 * Estado da cobrança, na linguagem do contrato (não do banco de pagamentos):
 * `not_found` = nenhuma cobrança com essa chave — o comando não chegou, ou a
 * cobrança foi recusada (recusa não deixa registro).
 */
export const PAYMENT_STATES = ["not_found", "pending", "authorized", "paid", "failed", "refunded"] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

/** `state` sempre; o resto, quando existe cobrança com a chave. */
export type StatusReply = { state: PaymentState } & Partial<AuthorizeReply>;

export function isPaymentState(value: unknown): value is PaymentState {
  return typeof value === "string" && (PAYMENT_STATES as readonly string[]).includes(value);
}
