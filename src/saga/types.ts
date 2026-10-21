import type { Transaction } from "@/db";

/** Saída de um passo — vai pro `context` da saga e fica disponível pros próximos. */
export type StepOutput = Record<string, unknown> | void;

export type StepContext<TPayload> = {
  sagaId: string;
  correlationId: string;
  /** Entrada imutável da saga. */
  payload: TPayload;
  /** Saídas acumuladas dos passos anteriores. */
  context: Record<string, unknown>;
  /** Tentativa atual deste passo (1 = primeira). */
  attempt: number;
};

/**
 * Um passo atômico da saga. `invoke` e `compensate` recebem a transação —
 * tudo que o passo escreve (incluindo o próprio log do passo) commita junto,
 * que é o que torna o passo "aplicado ou não aplicado", nunca pela metade.
 */
export type SagaStep<TPayload> = {
  name: string;
  /** Pula o passo quando ele não faz sentido (ex.: pedido sem cupom). */
  skip?: (ctx: StepContext<TPayload>) => boolean;
  invoke: (ctx: StepContext<TPayload>, tx: Transaction) => Promise<StepOutput>;
  /** Desfaz o passo. Ausente = passo sem efeito a desfazer. */
  compensate?: (ctx: StepContext<TPayload>, tx: Transaction) => Promise<void>;
};

export type SagaDefinition<TPayload> = {
  type: string;
  steps: SagaStep<TPayload>[];
  /** Tentativas por passo antes de desistir e compensar. */
  maxAttemptsPerStep?: number;
  /** Valida/normaliza o payload persistido (jsonb). */
  parsePayload: (raw: unknown) => TPayload;
  /** Encerramento do caminho triste, depois de desfazer todos os passos. */
  onCompensated?: (ctx: StepContext<TPayload>, tx: Transaction, reason: string) => Promise<void>;
};

export const DEFAULT_MAX_ATTEMPTS_PER_STEP = 3;
