import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { valuesOf } from "../helpers/form";
import { formatAttributes, parseAttributes, parseVariantForm } from "@/lib/validation/variant";

function form(values: Record<string, string | undefined>): FormData {
  const data = new FormData();
  const base: Record<string, string> = { name: "M / Preto", sku: "sku-m-preto", stock: "4" };
  for (const [key, value] of Object.entries({ ...base, ...values })) {
    if (value !== undefined) data.set(key, value);
  }
  return data;
}

describe("atributos da variante", () => {
  it("transforma linhas 'chave: valor' em objeto", () => {
    assert.deepEqual(parseAttributes("Tamanho: M\nCor: Preto"), { Tamanho: "M", Cor: "Preto" });
  });

  it("ignora linha vazia, sem separador ou sem valor", () => {
    assert.deepEqual(parseAttributes("Tamanho: M\n\nsem separador\nCor:\n: solto"), { Tamanho: "M" });
  });

  it("aceita ':' no valor (ex.: horário) e apara espaços", () => {
    assert.deepEqual(parseAttributes("  Edição :  Limitada: 2026  "), { Edição: "Limitada: 2026" });
  });

  it("formata de volta pro textarea", () => {
    assert.equal(formatAttributes({ Tamanho: "M", Cor: "Preto" }), "Tamanho: M\nCor: Preto");
    assert.equal(formatAttributes(null), "");
    assert.equal(formatAttributes([1, 2]), "", "array não é mapa de atributos");
  });

  it("ida e volta preserva os pares", () => {
    const original = "Tamanho: M\nCor: Preto";
    assert.equal(formatAttributes(parseAttributes(original)), original);
  });
});

describe("validação da variante", () => {
  it("aceita variante sem preço (herda do produto)", () => {
    const values = valuesOf(parseVariantForm(form({ price: "" })));
    assert.equal(values.priceCents, null);
    assert.equal(values.sku, "SKU-M-PRETO", "SKU vai pra maiúscula");
    assert.equal(values.stockQuantity, 4);
  });

  it("converte preço informado pra centavos", () => {
    assert.equal(valuesOf(parseVariantForm(form({ price: "99,90" }))).priceCents, 9_990);
    assert.ok(parseVariantForm(form({ price: "abc" })).errors.price);
  });

  it("exige nome e SKU com formato", () => {
    assert.ok(parseVariantForm(form({ name: "" })).errors.name);
    assert.ok(parseVariantForm(form({ sku: "ab" })).errors.sku);
    assert.ok(parseVariantForm(form({ sku: "sku com espaço" })).errors.sku);
    assert.equal(parseVariantForm(form({ sku: "abc" })).errors.sku, undefined);
  });

  it("estoque é inteiro não negativo", () => {
    assert.ok(parseVariantForm(form({ stock: "-1" })).errors.stock);
    assert.ok(parseVariantForm(form({ stock: "2,5" })).errors.stock);
    assert.ok(parseVariantForm(form({ stock: "" })).errors.stock);
    assert.equal(parseVariantForm(form({ stock: "0" })).errors.stock, undefined);
  });
});
