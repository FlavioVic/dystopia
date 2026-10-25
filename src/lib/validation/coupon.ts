/**
 * Formulário de cupom (admin). As regras de USO do cupom no checkout ficam em
 * `services/coupons/rules.ts`; aqui é só "o que o admin digitou faz sentido?".
 */

import { z } from "zod";
import { checked, cents, formStrings, optionalCents, optionalText, parseForm, wholeNumber } from "./form";

export const CODE_PATTERN = /^[A-Z0-9]{3,20}$/;
export const DISCOUNT_TYPES = ["percentage", "fixed"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

/** `<input type="date">` manda "2026-10-21" — vira meia-noite LOCAL, não UTC. */
export function parseDateInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Data do formulário; vazio vira `fallback()`. */
const dateInput = <F extends Date | null>(fallback: () => F) =>
  z.string().transform((value, ctx): Date | F => {
    const raw = value.trim();
    if (!raw) return fallback();
    const date = parseDateInput(raw);
    if (!date) {
      ctx.addIssue("Data inválida.");
      return z.NEVER;
    }
    return date;
  });

const common = {
  code: z.string().trim().toUpperCase().regex(CODE_PATTERN, "Use de 3 a 20 letras/números, sem espaço."),
  description: optionalText(),
  minOrder: optionalCents("Valor inválido.", 0),
  maxUsage: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.union([z.literal("").transform(() => null), wholeNumber("Deixe vazio para ilimitado, ou informe 1 ou mais.", 1)])),
  validFrom: dateInput(() => new Date()),
  validUntil: dateInput(() => null),
  isActive: z.boolean(),
};

// Percentual é inteiro de 1 a 100; fixo é dinheiro em centavos.
const couponSchema = z
  .discriminatedUnion(
    "discountType",
    [
      z.object({ ...common, discountType: z.literal("percentage"), discountValue: wholeNumber("Percentual de 1 a 100.", 1, 100) }),
      z.object({ ...common, discountType: z.literal("fixed"), discountValue: cents("Informe o valor do desconto.", 1) }),
    ],
    { error: "Escolha o tipo de desconto." },
  )
  .superRefine((coupon, ctx) => {
    if (coupon.validUntil && coupon.validUntil < coupon.validFrom) {
      ctx.addIssue({ code: "custom", path: ["validUntil"], message: "O fim não pode ser antes do início." });
    }
  })
  .transform(({ minOrder, validUntil, ...rest }) => ({
    ...rest,
    minOrderCents: minOrder,
    // Fim do dia: cupom válido "até 21/10" vale o dia 21 inteiro.
    validUntil: validUntil
      ? new Date(validUntil.getFullYear(), validUntil.getMonth(), validUntil.getDate(), 23, 59, 59)
      : null,
  }));

export type CouponFormValues = z.output<typeof couponSchema>;

const FIELDS = ["code", "description", "discountType", "discountValue", "minOrder", "maxUsage", "validFrom", "validUntil"] as const;

export function parseCouponForm(formData: FormData) {
  return parseForm(couponSchema, { ...formStrings(formData, FIELDS), isActive: checked(formData, "isActive") });
}
