/**
 * Serviço de cupom — responsabilidade única: validar, consumir e devolver uso.
 *
 * O `consume` é um UPDATE condicional (`usage_count < max_usage`): duas
 * compras simultâneas no último uso disponível não passam as duas. A que
 * perder recebe um erro PERMANENTE e a saga compensa.
 */

import { and, eq, isNull, or, sql } from "drizzle-orm";
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
