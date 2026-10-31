import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  errorCode,
  errorMessage,
  isRetryable,
  PermanentError,
  RetryableError,
  AppError,
} from "@/shared/errors";

describe("taxonomia de erro", () => {
  it("erro de negócio não é retentável", () => {
    const error = new PermanentError("out_of_stock", "Sem estoque", { productId: "x" });
    assert.equal(isRetryable(error), false);
    assert.equal(errorCode(error), "out_of_stock");
    assert.deepEqual(error.details, { productId: "x" });
    assert.ok(error instanceof AppError);
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
});
