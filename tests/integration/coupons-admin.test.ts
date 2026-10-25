/**
 * Administração de cupons: unicidade de código, limite coerente com o uso já
 * feito, e efeito direto no checkout (o cupom do admin é o mesmo que a saga
 * consome).
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { coupons } from "@/db/schema";
import { PermanentError } from "@/saga/errors";
import {
  consumeCoupon,
  createCoupon,
  resolveCoupon,
  setCouponActive,
  updateCoupon,
} from "@/services/coupons";
import { closeDatabase, resetDatabase } from "../helpers/db";

beforeEach(resetDatabase);
after(closeDatabase);

const input = {
  code: "PROMO10",
  description: "10% OFF",
  discountType: "percentage" as const,
  discountValue: 10,
  minOrderCents: 0,
  maxUsage: null,
  validFrom: new Date(Date.now() - 86_400_000),
  validUntil: null,
  isActive: true,
};

describe("cupom no admin", () => {
  it("cria e já vale no checkout", async () => {
    await createCoupon(db, input);

    const evaluation = await resolveCoupon(db, "promo10", 20_000);
    assert.equal(evaluation.ok, true);
    if (evaluation.ok) assert.equal(evaluation.discountCents, 2_000);
  });

  it("código é único", async () => {
    await createCoupon(db, input);
    await assert.rejects(
      () => createCoupon(db, { ...input, description: "outro" }),
      (error: unknown) => error instanceof PermanentError && error.code === "duplicate_coupon_code",
    );
  });

  it("editar troca as regras e mantém o código livre para ele mesmo", async () => {
    const { couponId } = await createCoupon(db, input);

    await updateCoupon(db, couponId, {
      ...input,
      discountType: "fixed",
      discountValue: 5_000,
      minOrderCents: 10_000,
    });

    const abaixoDoMinimo = await resolveCoupon(db, "PROMO10", 9_000);
    assert.equal(abaixoDoMinimo.ok, false);
    if (!abaixoDoMinimo.ok) assert.equal(abaixoDoMinimo.reason, "min_order");

    const acima = await resolveCoupon(db, "PROMO10", 20_000);
    assert.equal(acima.ok, true);
    if (acima.ok) assert.equal(acima.discountCents, 5_000);
  });

  it("não deixa o limite ficar abaixo do que já foi usado", async () => {
    const { couponId } = await createCoupon(db, { ...input, maxUsage: 5 });
    await consumeCoupon(db, couponId);
    await consumeCoupon(db, couponId);

    await assert.rejects(
      () => updateCoupon(db, couponId, { ...input, maxUsage: 1 }),
      (error: unknown) => error instanceof PermanentError && error.code === "max_usage_below_usage",
    );

    await updateCoupon(db, couponId, { ...input, maxUsage: 2 });
    const coupon = await db.query.coupons.findFirst({ where: eq(coupons.id, couponId) });
    assert.equal(coupon?.maxUsage, 2);

    const esgotado = await resolveCoupon(db, "PROMO10", 20_000);
    assert.equal(esgotado.ok, false, "limite igual ao uso já feito deixa o cupom esgotado");
  });

  it("desativar tira o cupom do checkout na hora", async () => {
    const { couponId } = await createCoupon(db, input);

    assert.deepEqual(await setCouponActive(db, couponId), { isActive: false });
    const desativado = await resolveCoupon(db, "PROMO10", 20_000);
    assert.equal(desativado.ok, false);
    if (!desativado.ok) assert.equal(desativado.reason, "inactive");

    assert.deepEqual(await setCouponActive(db, couponId), { isActive: true });
    assert.equal((await resolveCoupon(db, "PROMO10", 20_000)).ok, true);
  });

  it("avisa quando o cupom não existe", async () => {
    const inexistente = "00000000-0000-0000-0000-000000000000";
    await assert.rejects(
      () => setCouponActive(db, inexistente),
      (error: unknown) => error instanceof PermanentError && error.code === "coupon_not_found",
    );
    await assert.rejects(
      () => updateCoupon(db, inexistente, input),
      (error: unknown) => error instanceof PermanentError && error.code === "coupon_not_found",
    );
  });

  it("respeita a janela de validade", async () => {
    await createCoupon(db, {
      ...input,
      code: "FUTURO",
      validFrom: new Date(Date.now() + 86_400_000),
    });
    const futuro = await resolveCoupon(db, "FUTURO", 20_000);
    assert.equal(futuro.ok, false);
    if (!futuro.ok) assert.equal(futuro.reason, "not_started");

    await createCoupon(db, {
      ...input,
      code: "VENCIDO",
      validFrom: new Date(Date.now() - 172_800_000),
      validUntil: new Date(Date.now() - 86_400_000),
    });
    const vencido = await resolveCoupon(db, "VENCIDO", 20_000);
    assert.equal(vencido.ok, false);
    if (!vencido.ok) assert.equal(vencido.reason, "expired");
  });
});
