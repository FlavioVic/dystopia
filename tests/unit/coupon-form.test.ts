import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { valuesOf } from "../helpers/form";
import { formatDateInput, parseCouponForm, parseDateInput } from "@/lib/validation/coupon";

function form(values: Record<string, string | undefined>): FormData {
  const data = new FormData();
  const base: Record<string, string> = {
    code: "bemvindo10",
    discountType: "percentage",
    discountValue: "10",
    validFrom: "2026-10-01",
  };
  for (const [key, value] of Object.entries({ ...base, ...values })) {
    if (value !== undefined) data.set(key, value);
  }
  return data;
}

describe("datas do formulário de cupom", () => {
  it("interpreta a data como meia-noite LOCAL (não UTC)", () => {
    const date = parseDateInput("2026-10-21");
    assert.ok(date);
    assert.equal(date.getFullYear(), 2026);
    assert.equal(date.getMonth(), 9);
    assert.equal(date.getDate(), 21);
    assert.equal(date.getHours(), 0);
  });

  it("recusa formato inválido", () => {
    for (const value of ["", "21/10/2026", "2026-10", "ontem"]) {
      assert.equal(parseDateInput(value), null, `deveria recusar: ${value}`);
    }
  });

  it("formata de volta pro input sem escorregar de dia", () => {
    const date = new Date(2026, 0, 5);
    assert.equal(formatDateInput(date), "2026-01-05");
    assert.equal(formatDateInput(parseDateInput("2026-12-31")!), "2026-12-31");
  });
});

describe("validação do cupom", () => {
  it("aceita percentual e deixa o código em maiúsculo", () => {
    const values = valuesOf(parseCouponForm(form({ isActive: "on" })));
    assert.equal(values.code, "BEMVINDO10");
    assert.equal(values.discountType, "percentage");
    assert.equal(values.discountValue, 10);
    assert.equal(values.minOrderCents, 0);
    assert.equal(values.maxUsage, null, "vazio = ilimitado");
    assert.equal(values.isActive, true);
    assert.equal(values.validUntil, null);
  });

  it("aceita valor fixo em reais e converte pra centavos", () => {
    const values = valuesOf(parseCouponForm(
      form({ discountType: "fixed", discountValue: "25,50", minOrder: "150,00" }),
    ));
    assert.equal(values.discountValue, 2_550);
    assert.equal(values.minOrderCents, 15_000);
  });

  it("exige código no formato certo", () => {
    for (const code of ["", "ab", "cupom com espaço", "CUPOM-10", "A".repeat(21)]) {
      assert.ok(parseCouponForm(form({ code })).errors.code, `deveria recusar: "${code}"`);
    }
    assert.equal(parseCouponForm(form({ code: "ABC" })).errors.code, undefined);
    assert.equal(parseCouponForm(form({ code: "PROMO2026" })).errors.code, undefined);
  });

  it("percentual tem que ser inteiro de 1 a 100", () => {
    for (const value of ["0", "101", "-5", "10,5", "abc", ""]) {
      assert.ok(
        parseCouponForm(form({ discountValue: value })).errors.discountValue,
        `deveria recusar: ${value}`,
      );
    }
    assert.equal(parseCouponForm(form({ discountValue: "100" })).errors.discountValue, undefined);
  });

  it("valor fixo precisa ser maior que zero", () => {
    assert.ok(parseCouponForm(form({ discountType: "fixed", discountValue: "0" })).errors.discountValue);
    assert.ok(parseCouponForm(form({ discountType: "fixed", discountValue: "" })).errors.discountValue);
    assert.equal(
      parseCouponForm(form({ discountType: "fixed", discountValue: "0,01" })).errors.discountValue,
      undefined,
    );
  });

  it("limite de uso é vazio ou inteiro positivo", () => {
    assert.equal(valuesOf(parseCouponForm(form({ maxUsage: "" }))).maxUsage, null);
    assert.equal(valuesOf(parseCouponForm(form({ maxUsage: "5" }))).maxUsage, 5);
    assert.ok(parseCouponForm(form({ maxUsage: "0" })).errors.maxUsage);
    assert.ok(parseCouponForm(form({ maxUsage: "-2" })).errors.maxUsage);
    assert.ok(parseCouponForm(form({ maxUsage: "muitos" })).errors.maxUsage);
  });

  it("fim da validade não pode ser antes do início", () => {
    const { errors } = parseCouponForm(form({ validFrom: "2026-10-10", validUntil: "2026-10-01" }));
    assert.match(errors.validUntil, /antes do início/);
  });

  it("validade termina no fim do dia escolhido", () => {
    const values = valuesOf(parseCouponForm(form({ validFrom: "2026-10-01", validUntil: "2026-10-31" })));
    assert.ok(values.validUntil);
    assert.equal(values.validUntil.getDate(), 31);
    assert.equal(values.validUntil.getHours(), 23);
    assert.equal(values.validUntil.getMinutes(), 59);
  });

  it("checkbox ausente deixa o cupom inativo", () => {
    assert.equal(valuesOf(parseCouponForm(form({}))).isActive, false);
  });
});
