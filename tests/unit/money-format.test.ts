import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { errorDigest } from "@/lib/error-digest";
import { discountPercent, formatPriceCents, installmentText, isFreeShipping, FREE_SHIPPING_MIN_CENTS } from "@/lib/format";
import { toCents, toCentsOrDefault } from "@/lib/money";

describe("dinheiro digitado → centavos", () => {
  it("vírgula ou ponto, arredondando o centavo", () => {
    assert.equal(toCents("19,90"), 1_990);
    assert.equal(toCents("19.90"), 1_990);
    assert.equal(toCents("0,1"), 10);
    assert.equal(toCents("10,005"), 1_001, "meio centavo arredonda pra cima");
    assert.equal(toCents("  7 "), 700);
  });

  it("vazio, negativo ou lixo é null — nunca zero por acidente", () => {
    for (const value of ["", "   ", "-1", "abc", "1,2,3", "Infinity"]) {
      assert.equal(toCents(value), null, `"${value}"`);
    }
  });

  it("com padrão, só o vazio vira o padrão", () => {
    assert.equal(toCentsOrDefault("", 0), 0);
    assert.equal(toCentsOrDefault("abc", 0), null);
  });
});

describe("formatação de preço", () => {
  it("real brasileiro", () => {
    assert.equal(formatPriceCents(199_990).replace(/\s/g, " "), "R$ 1.999,90");
  });

  it("desconto só quando o preço 'de' é maior", () => {
    assert.equal(discountPercent(8_000, 10_000), 20);
    assert.equal(discountPercent(10_000, 10_000), null);
    assert.equal(discountPercent(10_000, null), null);
  });

  it("parcelamento só acima do mínimo por parcela", () => {
    assert.ok(installmentText(40_000));
    assert.equal(installmentText(1_000), null);
  });

  it("frete grátis a partir do mínimo", () => {
    assert.equal(isFreeShipping(FREE_SHIPPING_MIN_CENTS), true);
    assert.equal(isFreeShipping(FREE_SHIPPING_MIN_CENTS - 1), false);
  });
});

describe("código da ocorrência (tela de erro)", () => {
  it("lê o digest de qualquer objeto", () => {
    assert.equal(errorDigest(Object.assign(new Error("x"), { digest: "123" })), "123");
    assert.equal(errorDigest({ digest: "456" }), "456");
  });

  it("sem digest utilizável: null", () => {
    for (const value of [null, undefined, "erro", {}, { digest: "" }, { digest: 7 }]) {
      assert.equal(errorDigest(value), null);
    }
  });
});

describe("chave pública do Stripe", () => {
  it("só modo de teste: chave de produção desliga o cartão em vez de cobrar", async () => {
    const { getStripePublishableKey } = await import("@/lib/stripe-public");
    const original = process.env.STRIPE_PUBLISHABLE_KEY;
    try {
      process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_abc123";
      assert.equal(getStripePublishableKey(), "pk_test_abc123");
      process.env.STRIPE_PUBLISHABLE_KEY = "pk_live_abc123";
      assert.equal(getStripePublishableKey(), null);
      delete process.env.STRIPE_PUBLISHABLE_KEY;
      assert.equal(getStripePublishableKey(), null);
    } finally {
      if (original === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
      else process.env.STRIPE_PUBLISHABLE_KEY = original;
    }
  });
});
