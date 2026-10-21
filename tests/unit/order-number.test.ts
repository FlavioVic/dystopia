import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateOrderNumber } from "@/services/orders";

describe("número do pedido", () => {
  it("usa o formato DYS-<ano>-<6 dígitos> (ano local, como o cliente lê)", () => {
    const number = generateOrderNumber(new Date(2026, 9, 21), () => 0.123456);
    assert.match(number, /^DYS-2026-\d{6}$/);
  });

  it("completa com zeros à esquerda", () => {
    assert.equal(generateOrderNumber(new Date(2026, 0, 1), () => 0), "DYS-2026-000000");
    assert.equal(generateOrderNumber(new Date(2026, 0, 1), () => 0.000007), "DYS-2026-000007");
  });

  it("nunca estoura 6 dígitos", () => {
    assert.equal(generateOrderNumber(new Date(2026, 0, 1), () => 0.9999999), "DYS-2026-999999");
  });

  it("usa o ano da data informada", () => {
    assert.match(generateOrderNumber(new Date(2031, 4, 5), () => 0.5), /^DYS-2031-/);
  });
});
