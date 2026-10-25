import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPastLastPage, pageCount, parsePage } from "@/lib/pagination";

describe("paginação", () => {
  it("lê a página da URL e calcula o deslocamento", () => {
    assert.deepEqual(parsePage("3", 12), { page: 3, limit: 12, offset: 24 });
    assert.deepEqual(parsePage(["2", "9"], 12), { page: 2, limit: 12, offset: 12 });
  });

  it("valor inválido vira a primeira página", () => {
    for (const raw of [undefined, "", "0", "-1", "abc", "2.5", "1e3", "9999999"]) {
      assert.equal(parsePage(raw, 12).page, 1, `"${raw}"`);
    }
  });

  it("total de páginas: nunca menos que 1", () => {
    assert.equal(pageCount(0, 12), 1);
    assert.equal(pageCount(12, 12), 1);
    assert.equal(pageCount(13, 12), 2);
  });

  it("página além da última não existe; a 1ª de lista vazia existe", () => {
    assert.equal(isPastLastPage(1, 0, 12), false);
    assert.equal(isPastLastPage(3, 25, 12), false);
    assert.equal(isPastLastPage(4, 25, 12), true);
  });
});
