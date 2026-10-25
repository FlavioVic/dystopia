import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_SEARCH_TERMS, toPrefixQuery } from "@/lib/search";

describe("consulta de busca", () => {
  it("cada palavra vira prefixo obrigatório", () => {
    assert.equal(toPrefixQuery("RTX 5060"), "rtx:* & 5060:*");
  });

  it("operador de tsquery e curinga de LIKE não passam", () => {
    assert.equal(toPrefixQuery("ryzen & !(intel) | %_' :*"), "ryzen:* & intel:*");
  });

  it("hífen entre letras e números fica (SKU), solto cai", () => {
    assert.equal(toPrefixQuery("GPU-1"), "gpu-1:*");
    assert.equal(toPrefixQuery("- ryzen --"), "ryzen:*");
  });

  it("acento fica (quem tira é o banco, igual no índice)", () => {
    assert.equal(toPrefixQuery("Memória"), "memória:*");
  });

  it("só símbolo ou vazio: nem consulta", () => {
    assert.equal(toPrefixQuery("   "), null);
    assert.equal(toPrefixQuery("%%% ***"), null);
  });

  it("limita a quantidade de termos", () => {
    const query = toPrefixQuery(Array.from({ length: 20 }, (_, i) => `t${i}`).join(" "));
    assert.equal(query?.split(" & ").length, MAX_SEARCH_TERMS);
  });
});
