/**
 * Taxonomia de erro da saga.
 *
 * A distinção é o que define o comportamento do orquestrador:
 *
 * - `PermanentError`  → regra de negócio violada (sem estoque, pagamento
 *   recusado, cupom esgotado). Não existe "tentar de novo": compensa agora.
 * - `RetryableError`  → falha transitória (rede, deadlock, provedor fora).
 *   Volta pra fila com backoff até esgotar as tentativas do passo.
 *
 * Erro desconhecido é tratado como transitório de propósito: é mais seguro
 * tentar de novo algumas vezes do que cancelar um pedido por um soluço de
 * infraestrutura. O limite de tentativas garante que não roda pra sempre.
 */

export type ErrorDetails = Record<string, unknown>;

export class SagaError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: ErrorDetails;

  constructor(code: string, message: string, retryable: boolean, details?: ErrorDetails) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

/** Falha de negócio: compensa imediatamente, sem retry. */
export class PermanentError extends SagaError {
  constructor(code: string, message: string, details?: ErrorDetails) {
    super(code, message, false, details);
  }
}

/** Falha transitória: tenta de novo com backoff. */
export class RetryableError extends SagaError {
  constructor(code: string, message: string, details?: ErrorDetails) {
    super(code, message, true, details);
  }
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof SagaError) return error.retryable;
  return true; // desconhecido => transitório (ver comentário do topo)
}

export function errorCode(error: unknown): string {
  if (error instanceof SagaError) return error.code;
  return "unknown_error";
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Mensagem curta pro cliente final — sem vazar detalhe de infraestrutura. */
export function customerFacingMessage(code: string): string {
  switch (code) {
    case "out_of_stock":
      return "Um item do pedido ficou sem estoque.";
    case "payment_declined":
      return "O pagamento foi recusado pela operadora.";
    case "coupon_exhausted":
      return "O cupom usado esgotou antes da confirmação.";
    case "invalid_payload":
      return "Os dados do pedido ficaram inconsistentes.";
    default:
      return "Não foi possível concluir o pedido.";
  }
}
