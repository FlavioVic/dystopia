import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeDiscountCents, evaluateCoupon, normalizeCode, type CouponLike } from "@/services/coupons/rules";

const NOW = new Date("2026-10-21T12:00:00.000Z");

function coupon(overrides: Partial<CouponLike> = {}): CouponLike {
  return {
    id: "cupom-1",
    code: "BEMVINDO10",
    discountType: "percentage",
    discountValue: 10,
    minOrderCents: 0,
    maxUsage: null,
    usageCount: 0,
    validFrom: new Date("2026-01-01T00:00:00.000Z"),
    validUntil: null,
    isActive: true,
    ...overrides,
  };
}

describe("cálculo do desconto", () => {
  it("aplica percentual arredondando para baixo", () => {
    assert.equal(computeDiscountCents(coupon({ discountValue: 10 }), 9_999), 999);
    assert.equal(computeDiscountCents(coupon({ discountValue: 15 }), 10_000), 1_500);
  });

  it("aplica valor fixo limitado ao subtotal", () => {
    const fixed = coupon({ discountType: "fixed", discountValue: 5_000 });
    assert.equal(computeDiscountCents(fixed, 10_000), 5_000);
    assert.equal(computeDiscountCents(fixed, 3_000), 3_000, "não deixa o total negativo");
  });

  it("não quebra com percentual fora da faixa nem subtotal zero", () => {
    assert.equal(computeDiscountCents(coupon({ discountValue: 150 }), 10_000), 10_000);
    assert.equal(computeDiscountCents(coupon({ discountValue: -10 }), 10_000), 0);
    assert.equal(computeDiscountCents(coupon(), 0), 0);
  });
});

describe("validação do cupom", () => {
  it("aceita cupom válido", () => {
    const result = evaluateCoupon(coupon(), 10_000, NOW);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.discountCents, 1_000);
      assert.equal(result.couponId, "cupom-1");
    }
  });

  it("recusa cupom inexistente", () => {
    const result = evaluateCoupon(null, 10_000, NOW);
    assert.deepEqual(result, { ok: false, reason: "not_found", message: "Cupom inválido ou inativo." });
  });

  it("recusa cupom inativo", () => {
    const result = evaluateCoupon(coupon({ isActive: false }), 10_000, NOW);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "inactive");
  });

  it("recusa cupom que ainda não começou", () => {
    const result = evaluateCoupon(coupon({ validFrom: new Date("2027-01-01") }), 10_000, NOW);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "not_started");
  });

  it("recusa cupom expirado", () => {
    const result = evaluateCoupon(coupon({ validUntil: new Date("2026-10-20") }), 10_000, NOW);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "expired");
  });

  it("recusa cupom esgotado e aceita quando ainda sobra uso", () => {
    const esgotado = evaluateCoupon(coupon({ maxUsage: 5, usageCount: 5 }), 10_000, NOW);
    assert.equal(esgotado.ok, false);
    if (!esgotado.ok) assert.equal(esgotado.reason, "exhausted");

    const ultimo = evaluateCoupon(coupon({ maxUsage: 5, usageCount: 4 }), 10_000, NOW);
    assert.equal(ultimo.ok, true);
  });

  it("recusa quando o pedido não bate o mínimo e informa o valor", () => {
    const result = evaluateCoupon(coupon({ minOrderCents: 15_000 }), 10_000, NOW);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "min_order");
      assert.match(result.message, /150,00/);
    }
  });

  it("normaliza o código digitado", () => {
    assert.equal(normalizeCode("  bemvindo10 "), "BEMVINDO10");
    assert.equal(normalizeCode(""), "");
  });
});
