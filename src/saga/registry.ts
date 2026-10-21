import type { SagaDefinition } from "./types";
import { checkoutSaga } from "./definitions/checkout";

/**
 * Registro de sagas conhecidas. O orquestrador é genérico: ele só sabe
 * executar passos e compensar — quem descreve o fluxo é a definição.
 */
const definitions: Record<string, SagaDefinition<never>> = {
  [checkoutSaga.type]: checkoutSaga as unknown as SagaDefinition<never>,
};

export function getSagaDefinition(type: string): SagaDefinition<never> | undefined {
  return definitions[type];
}

export function sagaTypes(): string[] {
  return Object.keys(definitions);
}
