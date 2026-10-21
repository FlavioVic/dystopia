/**
 * Serviço de cupom — responsabilidade única: validar, consumir e devolver uso.
 *
 * O `consume` é um UPDATE condicional (`usage_count < max_usage`): duas
 * compras simultâneas no último uso disponível não passam as duas. A que
 * perder recebe um erro PERMANENTE e a saga compensa.
 */

import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { coupons } from "@/db/schema";
import { PermanentError } from "@/saga/errors";
import { evaluateCoupon, normalizeCode, type CouponEvaluation, type CouponLike } from "./rules";

export async function findCouponByCode(executor: Executor, rawCode: string): Promise<CouponLike | null> {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  const row = await executor.query.coupons.findFirst({ where: eq(coupons.code, code) });
  return row ?? null;
}

/** Valida um cupom contra o subtotal atual (preview do checkout e saga). */
export async function resolveCoupon(
  executor: Executor,
  rawCode: string,
  subtotalCents: number,
  now: Date = new Date(),
): Promise<CouponEvaluation> {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, reason: "not_found", message: "Informe um código." };
  const coupon = await findCouponByCode(executor, code);
  return evaluateCoupon(coupon, subtotalCents, now);
}

/** Incrementa o uso do cupom, respeitando `max_usage`. */
export async function consumeCoupon(executor: Executor, couponId: string): Promise<{ usageCount: number }> {
  const updated = await executor
    .update(coupons)
    .set({ usageCount: sql`${coupons.usageCount} + 1` })
    .where(
      and(
        eq(coupons.id, couponId),
        eq(coupons.isActive, true),
        or(isNull(coupons.maxUsage), sql`${coupons.usageCount} < ${coupons.maxUsage}`),
      ),
    )
    .returning({ usageCount: coupons.usageCount });

  if (updated.length === 0) {
    throw new PermanentError("coupon_exhausted", "O cupom não está mais disponível.", { couponId });
  }
  return { usageCount: updated[0].usageCount };
}

/** Compensação de `consumeCoupon`. */
export async function releaseCoupon(executor: Executor, couponId: string): Promise<void> {
  await executor
    .update(coupons)
    .set({ usageCount: sql`greatest(0, ${coupons.usageCount} - 1)` })
    .where(eq(coupons.id, couponId));
}

// ---------------------------------------------------------------------------
// Administração de cupons
// ---------------------------------------------------------------------------

export type CouponWriteInput = {
  code: string;
  description: string | null;
  discountType: "percentage" | "fixed";
  discountValue: number;
  minOrderCents: number;
  maxUsage: number | null;
  validFrom: Date;
  validUntil: Date | null;
  isActive: boolean;
};

export async function createCoupon(
  executor: Executor,
  input: CouponWriteInput,
): Promise<{ couponId: string }> {
  await assertCodeFree(executor, input.code);
  const [created] = await executor.insert(coupons).values(input).returning({ id: coupons.id });
  return { couponId: created.id };
}

export async function updateCoupon(
  executor: Executor,
  couponId: string,
  input: CouponWriteInput,
): Promise<void> {
  const existing = await executor.query.coupons.findFirst({
    where: eq(coupons.id, couponId),
    columns: { id: true, usageCount: true },
  });
  if (!existing) {
    throw new PermanentError("coupon_not_found", "Cupom não encontrado.", { couponId });
  }
  if (input.maxUsage != null && input.maxUsage < existing.usageCount) {
    throw new PermanentError(
      "max_usage_below_usage",
      `O cupom já foi usado ${existing.usageCount} vez(es) — o limite não pode ser menor.`,
      { couponId, usageCount: existing.usageCount },
    );
  }

  await assertCodeFree(executor, input.code, couponId);
  await executor.update(coupons).set(input).where(eq(coupons.id, couponId));
}

export async function setCouponActive(
  executor: Executor,
  couponId: string,
): Promise<{ isActive: boolean }> {
  const coupon = await executor.query.coupons.findFirst({
    where: eq(coupons.id, couponId),
    columns: { isActive: true },
  });
  if (!coupon) throw new PermanentError("coupon_not_found", "Cupom não encontrado.", { couponId });

  const isActive = !coupon.isActive;
  await executor.update(coupons).set({ isActive }).where(eq(coupons.id, couponId));
  return { isActive };
}

async function assertCodeFree(
  executor: Executor,
  code: string,
  ignoreCouponId?: string,
): Promise<void> {
  const existing = await executor.query.coupons.findFirst({
    where: ignoreCouponId
      ? and(eq(coupons.code, code), ne(coupons.id, ignoreCouponId))
      : eq(coupons.code, code),
    columns: { id: true },
  });
  if (existing) {
    throw new PermanentError("duplicate_coupon_code", "Já existe cupom com esse código.", { code });
  }
}
