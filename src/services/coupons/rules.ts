import { formatPriceCents } from "@/lib/format";

/**
 * Regras de cupom — funções PURAS (sem banco, sem Next). São a fonte da
 * verdade do desconto, usadas tanto no preview do checkout quanto no passo da
 * saga que consome o cupom. Por serem puras, dá para testar todos os cantos.
 */

export type CouponLike = {
  id: string;
  code: string;
  discountType: "percentage" | "fixed";
  discountValue: number; // % (0-100) ou centavos
  minOrderCents: number;
  maxUsage: number | null;
  usageCount: number;
  validFrom: Date;
  validUntil: Date | null;
  isActive: boolean;
};

export type CouponRejection =
  | "not_found"
  | "inactive"
  | "not_started"
  | "expired"
  | "exhausted"
  | "min_order";

export type CouponEvaluation =
  | { ok: true; couponId: string; code: string; discountCents: number }
  | { ok: false; reason: CouponRejection; message: string };

/** Desconto em centavos, já limitado ao subtotal (nunca deixa o total negativo). */
export function computeDiscountCents(coupon: CouponLike, subtotalCents: number): number {
  if (subtotalCents <= 0) return 0;
  if (coupon.discountType === "percentage") {
    const pct = Math.min(100, Math.max(0, coupon.discountValue));
    return Math.min(subtotalCents, Math.floor((subtotalCents * pct) / 100));
  }
  return Math.min(Math.max(0, coupon.discountValue), subtotalCents);
}

export function evaluateCoupon(
  coupon: CouponLike | null | undefined,
  subtotalCents: number,
  now: Date,
): CouponEvaluation {
  if (!coupon) return { ok: false, reason: "not_found", message: "Cupom inválido ou inativo." };
  if (!coupon.isActive) return { ok: false, reason: "inactive", message: "Cupom inválido ou inativo." };
  if (coupon.validFrom > now) {
    return { ok: false, reason: "not_started", message: "Cupom ainda não está válido." };
  }
  if (coupon.validUntil && coupon.validUntil < now) {
    return { ok: false, reason: "expired", message: "Cupom expirado." };
  }
  if (coupon.maxUsage != null && coupon.usageCount >= coupon.maxUsage) {
    return { ok: false, reason: "exhausted", message: "Cupom esgotado." };
  }
  if (subtotalCents < coupon.minOrderCents) {
    return {
      ok: false,
      reason: "min_order",
      message: `Pedido mínimo de ${formatPriceCents(coupon.minOrderCents)}.`,
    };
  }

  return {
    ok: true,
    couponId: coupon.id,
    code: coupon.code,
    discountCents: computeDiscountCents(coupon, subtotalCents),
  };
}

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}
