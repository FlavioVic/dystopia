import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  customerFacingMessage,
  errorCode,
  errorMessage,
  isRetryable,
  PermanentError,
  RetryableError,
  SagaError,
} from "@/saga/errors";

describe("taxonomia de erro da saga", () => {
  it("erro de negócio não é retentável", () => {
    const error = new PermanentError("out_of_stock", "Sem estoque", { productId: "x" });
    assert.equal(isRetryable(error), false);
    assert.equal(errorCode(error), "out_of_stock");
    assert.deepEqual(error.details, { productId: "x" });
    assert.ok(error instanceof SagaError);
    assert.equal(error.name, "PermanentError");
  });

  it("erro transitório é retentável", () => {
    const error = new RetryableError("gateway_unavailable", "Provedor fora");
    assert.equal(isRetryable(error), true);
    assert.equal(error.name, "RetryableError");
  });

  it("erro desconhecido é tratado como transitório", () => {
    assert.equal(isRetryable(new Error("deu ruim")), true);
    assert.equal(isRetryable("string solta"), true);
    assert.equal(errorCode(new Error("deu ruim")), "unknown_error");
  });

  it("extrai mensagem de qualquer coisa", () => {
    assert.equal(errorMessage(new Error("falhou")), "falhou");
    assert.equal(errorMessage("texto"), "texto");
    assert.equal(errorMessage(undefined), "undefined");
  });

  it("traduz o código para o cliente sem vazar detalhe técnico", () => {
    assert.match(customerFacingMessage("out_of_stock"), /estoque/i);
    assert.match(customerFacingMessage("payment_declined"), /recusado/i);
    assert.match(customerFacingMessage("coupon_exhausted"), /cupom/i);
    assert.match(customerFacingMessage("deadlock_detected_42P01"), /Não foi possível concluir/i);
  });
});
