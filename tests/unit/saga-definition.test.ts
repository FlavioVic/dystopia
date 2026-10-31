import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkoutSaga } from "@/saga/definitions/checkout";
import { checkoutSagaV1 } from "@/saga/definitions/checkout.v1";
import { currentSagaVersion, getSagaDefinition, validateSagaDefinition } from "@/saga/registry";
import type { SagaDefinition, SagaStep, StepKind } from "@/saga/types";

const noop = async () => {};
const step = (name: string, kind: StepKind, compensate = false): SagaStep<unknown> => ({
  name,
  kind,
  invoke: noop,
  ...(compensate ? { compensate: noop } : {}),
});
const saga = (steps: SagaStep<unknown>[]): SagaDefinition<unknown> => ({
  type: "teste",
  version: 1,
  steps,
  parsePayload: (raw) => raw,
});

describe("forma da saga (compensáveis → pivô → retentáveis)", () => {
  it("aceita a forma clássica", () => {
    validateSagaDefinition(
      saga([step("a", "compensatable", true), step("b", "pivot"), step("c", "retriable"), step("d", "retriable")]),
    );
  });

  it("recusa compensável depois do pivô", () => {
    assert.throws(
      () => validateSagaDefinition(saga([step("a", "pivot"), step("b", "compensatable", true)])),
      /fora de ordem/,
    );
  });

  it("recusa dois pivôs", () => {
    assert.throws(() => validateSagaDefinition(saga([step("a", "pivot"), step("b", "pivot")])), /mais de um pivô/);
  });

  it("recusa compensação em pivô ou retentável (depois do ponto sem volta nada se desfaz)", () => {
    assert.throws(() => validateSagaDefinition(saga([step("a", "pivot", true)])), /não pode ter compensação/);
    assert.throws(
      () => validateSagaDefinition(saga([step("a", "pivot"), step("b", "retriable", true)])),
      /não pode ter compensação/,
    );
  });

  it("recusa nome de passo repetido (o log de passos é por nome)", () => {
    assert.throws(
      () => validateSagaDefinition(saga([step("a", "compensatable"), step("a", "compensatable")])),
      /passo repetido/,
    );
  });
});

describe("saga de checkout", () => {
  it("v2: tudo que falha por regra vem antes da cobrança, que é o pivô", () => {
    assert.deepEqual(
      checkoutSaga.steps.map((s) => [s.name, s.kind]),
      [
        ["reserve-stock", "compensatable"],
        ["consume-coupon", "compensatable"],
        ["authorize-payment", "pivot"],
        ["confirm-order", "retriable"],
        ["clear-cart", "retriable"],
        ["notify-customer", "retriable"],
      ],
    );
  });

  it("saga nova nasce na v2; a v1 continua registrada para quem começou nela", () => {
    assert.equal(currentSagaVersion("checkout"), 2);
    assert.equal(getSagaDefinition("checkout", 2), checkoutSaga);
    assert.equal(getSagaDefinition("checkout", 1), checkoutSagaV1);
    assert.equal(getSagaDefinition("checkout", 3), undefined);
  });
});
