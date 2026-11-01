import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  errorCode,
  errorMessage,
  isRetryable,
  PermanentError,
  RetryableError,
  AppError,
  rootCauseMessage,
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

describe("causa raiz", () => {
  it("desembrulha o erro do driver que o Drizzle envolveu", () => {
    const driver = Object.assign(new Error("getaddrinfo ENOTFOUND base"), { code: "ENOTFOUND" });
    const wrapped = new Error("Failed query: select 1\nparams: ", { cause: driver });
    assert.equal(rootCauseMessage(wrapped), "getaddrinfo ENOTFOUND base");
  });

  it("de um AggregateError (IPv4 e IPv6), vale a primeira tentativa", () => {
    const attempts = [new Error("connect ECONNREFUSED ::1:5432"), new Error("connect ECONNREFUSED 127.0.0.1:5432")];
    const aggregate = Object.assign(new AggregateError(attempts, ""), { code: "ECONNREFUSED" });
    assert.equal(rootCauseMessage(new Error("Failed query", { cause: aggregate })), "connect ECONNREFUSED ::1:5432");
  });

  it("sem mensagem nenhuma, usa o código; sem causa, a própria mensagem", () => {
    assert.equal(rootCauseMessage(Object.assign(new AggregateError([], ""), { code: "ECONNREFUSED" })), "ECONNREFUSED");
    assert.equal(rootCauseMessage(new Error("simples")), "simples");
    assert.equal(rootCauseMessage("texto"), "texto");
  });
});
