import type { Transaction } from "@/db";

/** Saída de um passo — vai para o `context` da saga e fica disponível para os próximos. */
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

/** Comando para outro serviço, entregue pela fila (ver queue/reply.ts). */
export type StepRequest = {
  type: string;
  queue: string;
  payload: Record<string, unknown>;
};

/**
 * Papel do passo na saga — o vocabulário de Garcia-Molina & Salem (1987),
 * popularizado por Chris Richardson em "Microservices Patterns":
 *
 * - `compensatable` → tem como desfazer. Vem ANTES do pivô: se algo falha
 *   depois dele (até o pivô), a saga desfaz em ordem reversa.
 * - `pivot` → o ponto sem volta (no checkout, a cobrança). Se ele passa, a
 *   saga TEM que terminar; se ele falha, desfaz os compensáveis. Nunca é
 *   desfeito pela saga.
 * - `retriable` → vem DEPOIS do pivô e não pode desistir: falha transitória
 *   tenta de novo; falha de regra (ou tentativas esgotadas) para a saga em
 *   `halted` para alguém corrigir a causa e retomar. Nunca desfaz nada.
 *
 * `validateSagaDefinition` (registry) recusa uma definição fora dessa ordem.
 */
export type StepKind = "compensatable" | "pivot" | "retriable";

type StepBase<TPayload> = {
  name: string;
  kind: StepKind;
  /** Tentativas deste passo antes de desistir (sobrepõe o padrão da definição). */
  maxAttempts?: number;
  /** Pula o passo quando ele não faz sentido (ex.: pedido sem cupom). */
  skip?: (ctx: StepContext<TPayload>) => boolean;
};

/**
 * Passo local: `invoke` e `compensate` recebem a transação — tudo que o passo
 * escreve (incluindo o próprio log do passo) commita junto, que é o que torna
 * o passo "aplicado ou não aplicado", nunca pela metade.
 */
export type LocalSagaStep<TPayload> = StepBase<TPayload> & {
  invoke: (ctx: StepContext<TPayload>, tx: Transaction) => Promise<StepOutput>;
  /** Desfaz o passo. Ausente = passo sem efeito a desfazer. */
  compensate?: (ctx: StepContext<TPayload>, tx: Transaction) => Promise<void>;
};

/**
 * Passo remoto: o efeito acontece em OUTRO serviço. A saga grava o passo como
 * `waiting` e enfileira o comando na mesma transação (outbox), solta o lease
 * e só volta quando a resposta chega. O efeito e o log do passo não commitam
 * juntos — quem segura isso é a chave de idempotência do comando + resposta
 * aplicada uma vez só.
 */
export type RemoteSagaStep<TPayload> = StepBase<TPayload> & {
  request: (ctx: StepContext<TPayload>) => StepRequest;
  /** Comando que desfaz o passo. Ausente = sem efeito a desfazer. */
  compensateRequest?: (ctx: StepContext<TPayload>) => StepRequest;
  /**
   * Prazo da resposta. Vencido, a reconciliação pergunta o status (`status`)
   * ou, sem consulta, reenvia o comando — que por isso tem que ser
   * idempotente. A cada vez o prazo dobra (até 30 min). Sem prazo, a saga
   * espera para sempre.
   */
  timeoutMs?: number;
  /** Consulta de status do outro serviço, para quando a resposta não vem. */
  status?: StatusQuery<TPayload>;
};

/** Ida (`invoke`) ou volta (`compensate`) de um passo remoto. */
export type StepPhase = "invoke" | "compensate";

/**
 * O que a resposta da consulta diz sobre o comando que ficou sem resposta:
 * - `succeeded` / `failed` → o comando chegou lá e terminou: vale como a resposta;
 * - `unknown` → o outro lado não tem registro: o comando se perdeu (DLQ,
 *   fila apagada) e é reenviado — seguro, porque é idempotente;
 * - `in-progress` → ainda processando: espera mais um prazo.
 */
export type StatusResolution =
  | { outcome: "succeeded"; output: Record<string, unknown> }
  | { outcome: "failed"; code: string; message: string }
  | { outcome: "unknown" }
  | { outcome: "in-progress" };

export type StatusQuery<TPayload> = {
  request: (ctx: StepContext<TPayload>, phase: StepPhase) => StepRequest;
  resolve: (output: Record<string, unknown>, phase: StepPhase) => StatusResolution;
};

/** Teto do prazo depois de várias consultas sem resposta. */
export const MAX_STEP_DEADLINE_MS = 30 * 60_000;

export type SagaStep<TPayload> = LocalSagaStep<TPayload> | RemoteSagaStep<TPayload>;

/** Passo sem papel: o mesmo passo reaproveitado em versões diferentes da saga. */
export type LocalStepBody<TPayload> = Omit<LocalSagaStep<TPayload>, "kind">;
export type RemoteStepBody<TPayload> = Omit<RemoteSagaStep<TPayload>, "kind">;

export function isRemoteStep<TPayload>(step: SagaStep<TPayload>): step is RemoteSagaStep<TPayload> {
  return "request" in step;
}

export function hasCompensation<TPayload>(step: SagaStep<TPayload>): boolean {
  return isRemoteStep(step) ? step.compensateRequest != null : step.compensate != null;
}

export type SagaDefinition<TPayload> = {
  type: string;
  /**
   * Versão da definição. A saga grava a versão com que começou e termina
   * nela: mudar a ordem dos passos é uma versão NOVA, e a antiga fica
   * registrada até não haver mais saga dela em andamento.
   */
  version: number;
  steps: SagaStep<TPayload>[];
  /** Tentativas por passo antes de desistir (compensar ou parar). */
  maxAttemptsPerStep?: number;
  /** Valida/normaliza o payload persistido (jsonb). */
  parsePayload: (raw: unknown) => TPayload;
  /**
   * Código de erro → motivo em palavras de cliente (sem detalhe técnico). É a
   * definição que sabe o que "out_of_stock" quer dizer naquele fluxo.
   */
  describeFailure?: (code: string) => string;
  /** Encerramento do caminho triste, depois de desfazer todos os passos. */
  onCompensated?: (ctx: StepContext<TPayload>, tx: Transaction, reason: string) => Promise<void>;
};

export const DEFAULT_MAX_ATTEMPTS_PER_STEP = 3;
/**
 * Passo depois do pivô não desiste fácil: com o backoff (1 s, 2 s, 4 s… até
 * 60 s), 8 tentativas cobrem uns 2 minutos de instabilidade antes de parar.
 */
export const DEFAULT_RETRIABLE_MAX_ATTEMPTS = 8;
