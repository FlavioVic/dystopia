import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLowStock, LOW_STOCK_MAX, unitPriceCents } from "@/lib/catalog-rules";

/** Regras que a tela mostra e o servidor aplica — um lugar só para as duas. */
describe("regras do catálogo", () => {
  it("estoque baixo é de 1 até o limite; zero é esgotado, não baixo", () => {
    assert.equal(isLowStock(0), false);
    assert.equal(isLowStock(1), true);
    assert.equal(isLowStock(LOW_STOCK_MAX), true);
    assert.equal(isLowStock(LOW_STOCK_MAX + 1), false);
  });

  it("preço da variante quando ela tem; senão, o do produto (zero é preço, não ausência)", () => {
    assert.equal(unitPriceCents(10_000, 12_000), 12_000);
    assert.equal(unitPriceCents(10_000, null), 10_000);
    assert.equal(unitPriceCents(10_000, undefined), 10_000);
    assert.equal(unitPriceCents(10_000, 0), 0);
  });
});
