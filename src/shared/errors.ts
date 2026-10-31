/**
 * Taxonomia de erro do sistema — compartilhada por serviços, fila e saga.
 *
 * Mora fora da saga de propósito: é o serviço que sabe se uma falha é regra
 * de negócio ou soluço de infraestrutura, e quem decide o que fazer com isso
 * (a fila, a saga, a borda HTTP) só lê a classificação.
 *
 * - `PermanentError`  → regra de negócio violada (sem estoque, pagamento
 *   recusado, cupom esgotado). Não existe "tentar de novo".
 * - `RetryableError`  → falha transitória (rede, deadlock, provedor fora).
 *   Volta para a fila com backoff até esgotar as tentativas.
 *
 * Erro desconhecido é tratado como transitório de propósito: é mais seguro
 * tentar de novo algumas vezes do que cancelar um pedido por um soluço de
 * infraestrutura. O limite de tentativas garante que não roda para sempre.
 */

export type ErrorDetails = Record<string, unknown>;

export class AppError extends Error {
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

/** Falha de negócio: não adianta repetir. */
export class PermanentError extends AppError {
  constructor(code: string, message: string, details?: ErrorDetails) {
    super(code, message, false, details);
  }
}

/** Falha transitória: tenta de novo com backoff. */
export class RetryableError extends AppError {
  constructor(code: string, message: string, details?: ErrorDetails) {
    super(code, message, true, details);
  }
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof AppError) return error.retryable;
  return true; // desconhecido => transitório (ver comentário do topo)
}

export function errorCode(error: unknown): string {
  if (error instanceof AppError) return error.code;
  return "unknown_error";
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
