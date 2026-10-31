import { checkoutSaga } from "./definitions/checkout";
import { checkoutSagaV1 } from "./definitions/checkout.v1";
import { hasCompensation, type SagaDefinition } from "./types";

/**
 * Registro de sagas conhecidas, por tipo E versão. O orquestrador é genérico:
 * ele só sabe executar passos e compensar — quem descreve o fluxo é a
 * definição, e a saga roda sempre na versão com que começou.
 */

type AnyDefinition = SagaDefinition<never>;

/**
 * Confere a forma da saga: compensáveis → no máximo um pivô → retentáveis.
 * Pivô e retentável não têm compensação (ninguém desfaz o que vem depois do
 * ponto sem volta). Lança na carga do módulo: definição torta não sobe.
 */
export function validateSagaDefinition(definition: SagaDefinition<unknown>): void {
  const where = `${definition.type} v${definition.version}`;
  const names = new Set<string>();
  const order = { compensatable: 0, pivot: 1, retriable: 2 } as const;
  let phase = 0;
  let pivots = 0;

  for (const step of definition.steps) {
    if (names.has(step.name)) throw new Error(`${where}: passo repetido "${step.name}"`);
    names.add(step.name);

    if (order[step.kind] < phase) {
      throw new Error(`${where}: "${step.name}" (${step.kind}) fora de ordem — compensáveis, pivô, retentáveis`);
    }
    phase = order[step.kind];

    if (step.kind === "pivot") pivots += 1;
    if (step.kind !== "compensatable" && hasCompensation(step)) {
      throw new Error(`${where}: "${step.name}" é ${step.kind} e não pode ter compensação`);
    }
  }
  if (pivots > 1) throw new Error(`${where}: mais de um pivô`);
}

function register(definitions: SagaDefinition<unknown>[]): Map<string, AnyDefinition> {
  const byKey = new Map<string, AnyDefinition>();
  for (const definition of definitions) {
    validateSagaDefinition(definition);
    const key = `${definition.type}@${definition.version}`;
    if (byKey.has(key)) throw new Error(`saga registrada duas vezes: ${key}`);
    byKey.set(key, definition as unknown as AnyDefinition);
  }
  return byKey;
}

const definitions = register([
  checkoutSaga as SagaDefinition<unknown>,
  // v1: cupom depois do pagamento e tudo compensável. Fica até não haver
  // mais saga v1 em andamento (`select count(*) from sagas where
  // definition_version = 1 and status in ('running','compensating')`).
  checkoutSagaV1 as SagaDefinition<unknown>,
]);

export function getSagaDefinition(type: string, version: number): AnyDefinition | undefined {
  return definitions.get(`${type}@${version}`);
}

/** Versão em que uma saga NOVA desse tipo começa (a maior registrada). */
export function currentSagaVersion(type: string): number | undefined {
  let latest: number | undefined;
  for (const definition of definitions.values()) {
    if (definition.type === type && (latest === undefined || definition.version > latest)) latest = definition.version;
  }
  return latest;
}
