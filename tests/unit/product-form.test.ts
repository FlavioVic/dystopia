import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseProductForm, toCents } from "@/lib/validation/product";

function form(values: Record<string, string | undefined>): FormData {
  const data = new FormData();
  const base: Record<string, string> = {
    name: "Caneca Cyberpunk",
    slug: "caneca-cyberpunk",
    description: "Caneca de cerâmica",
    sku: "SKU-1",
    categoryId: "11111111-1111-1111-1111-111111111111",
    price: "79,90",
    stock: "7",
  };
  for (const [key, value] of Object.entries({ ...base, ...values })) {
    if (value !== undefined) data.set(key, value);
  }
  return data;
}

describe("conversão de preço", () => {
  it("aceita vírgula e ponto", () => {
    assert.equal(toCents("79,90"), 7_990);
    assert.equal(toCents("79.90"), 7_990);
    assert.equal(toCents("0"), 0);
  });

  it("recusa texto, negativo e vazio", () => {
    assert.equal(toCents("abc"), null);
    assert.equal(toCents("-5"), null);
    // Regressão: Number("") é 0, o que salvava produto a R$ 0,00 sem avisar.
    assert.equal(toCents(""), null);
    assert.equal(toCents("   "), null);
  });

  it("arredonda centavos", () => {
    assert.equal(toCents("10,999"), 1_100);
  });
});

describe("validação do formulário de produto", () => {
  it("aceita um formulário completo e normaliza os valores", () => {
    const { errors, values } = parseProductForm(
      form({ brand: "Dystopia Labs", compareAt: "119,90", isActive: "on", isFeatured: "on", slug: "CANECA-X" }),
    );
    assert.deepEqual(errors, {});
    assert.equal(values.slug, "caneca-x", "slug vira minúsculo");
    assert.equal(values.priceCents, 7_990);
    assert.equal(values.compareAtPriceCents, 11_990);
    assert.equal(values.stockQuantity, 7);
    assert.equal(values.brand, "Dystopia Labs");
    assert.equal(values.isActive, true);
    assert.equal(values.isFeatured, true);
  });

  it("trata checkbox ausente como falso e marca vazia como null", () => {
    const { values } = parseProductForm(form({}));
    assert.equal(values.isActive, false);
    assert.equal(values.isFeatured, false);
    assert.equal(values.brand, null);
    assert.equal(values.compareAtPriceCents, null);
  });

  it("exige preço (campo vazio não é zero)", () => {
    assert.equal(parseProductForm(form({ price: "" })).errors.price, "Preço inválido.");
    assert.equal(parseProductForm(form({ price: "abc" })).errors.price, "Preço inválido.");
    assert.equal(parseProductForm(form({ price: "-1" })).errors.price, "Preço inválido.");
  });

  it("valida nome, slug, descrição, SKU e categoria", () => {
    const { errors } = parseProductForm(
      form({ name: "A", slug: "Slug Inválido!", description: "", sku: "", categoryId: "" }),
    );
    assert.equal(errors.name, "Informe o nome.");
    assert.match(errors.slug, /minúsculas/);
    assert.equal(errors.description, "Informe a descrição.");
    assert.equal(errors.sku, "Informe o SKU.");
    assert.equal(errors.categoryId, "Escolha a categoria.");
  });

  it("valida estoque inteiro e não negativo", () => {
    assert.equal(parseProductForm(form({ stock: "-2" })).errors.stock, "Estoque inválido.");
    assert.equal(parseProductForm(form({ stock: "" })).errors.stock, "Estoque inválido.");
    assert.equal(parseProductForm(form({ stock: "2.5" })).errors.stock, undefined, "parseInt corta a fração");
  });

  it('exige que o preço "de" seja maior que o de venda', () => {
    assert.match(parseProductForm(form({ compareAt: "79,90" })).errors.compareAt, /maior/);
    assert.match(parseProductForm(form({ compareAt: "50,00" })).errors.compareAt, /maior/);
    assert.equal(parseProductForm(form({ compareAt: "xyz" })).errors.compareAt, "Valor inválido.");
    assert.equal(parseProductForm(form({ compareAt: "99,90" })).errors.compareAt, undefined);
  });
});
