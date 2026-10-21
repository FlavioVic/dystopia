/**
 * Backoff exponencial com jitter — usado pelos retries da fila.
 *
 * `random` é injetável de propósito: com `() => 0.5` o jitter é zero e o
 * cálculo fica determinístico (é assim que os testes verificam a curva).
 */

export type BackoffOptions = {
  /** Atraso da 1ª tentativa, em ms. */
  baseMs?: number;
  /** Teto do atraso, em ms. */
  maxMs?: number;
  /** Fração de variação aleatória aplicada ao atraso (0.2 = ±20%). */
  jitter?: number;
  random?: () => number;
};

export const DEFAULT_BACKOFF: Required<Omit<BackoffOptions, "random">> = {
  baseMs: 1_000,
  maxMs: 60_000,
  jitter: 0.2,
};

/**
 * Atraso até a próxima tentativa. `attempts` é o número de tentativas JÁ
 * feitas (1 = acabou de falhar a primeira).
 */
export function backoffMs(attempts: number, options: BackoffOptions = {}): number {
  const { baseMs, maxMs, jitter } = { ...DEFAULT_BACKOFF, ...options };
  const random = options.random ?? Math.random;

  const exponent = Math.max(0, attempts - 1);
  const base = Math.min(maxMs, baseMs * 2 ** exponent);
  const spread = base * jitter;
  const delta = (random() * 2 - 1) * spread; // [-spread, +spread]

  return Math.max(0, Math.min(maxMs, Math.round(base + delta)));
}

/** Momento da próxima tentativa. */
export function nextRunAt(attempts: number, now: Date, options: BackoffOptions = {}): Date {
  return new Date(now.getTime() + backoffMs(attempts, options));
}
