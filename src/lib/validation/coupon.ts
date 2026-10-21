/**
 * Validação do formulário de cupom (admin). Pura — as regras de uso do cupom
 * no checkout ficam em `services/coupons/rules.ts`; aqui é só "o que o admin
 * digitou faz sentido?".
 */

import { toCents, toCentsOrDefault } from "@/lib/money";

export const CODE_PATTERN = /^[A-Z0-9]{3,20}$/;
export const DISCOUNT_TYPES = ["percentage", "fixed"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export type CouponFormValues = {
  code: string;
  description: string | null;
  discountType: DiscountType;
  discountValue: number;
  minOrderCents: number;
  maxUsage: number | null;
  validFrom: Date;
  validUntil: Date | null;
  isActive: boolean;
};

export type CouponFormParse = {
  errors: Record<string, string>;
  values: CouponFormValues;
};

function field(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

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

export function parseCouponForm(formData: FormData): CouponFormParse {
  const code = field(formData, "code").toUpperCase();
  const description = field(formData, "description") || null;
  const typeRaw = field(formData, "discountType");
  const discountType: DiscountType = typeRaw === "fixed" ? "fixed" : "percentage";
  const valueRaw = field(formData, "discountValue");
  const minOrderRaw = field(formData, "minOrder");
  const maxUsageRaw = field(formData, "maxUsage");
  const validFromRaw = field(formData, "validFrom");
  const validUntilRaw = field(formData, "validUntil");
  const isActive = formData.get("isActive") != null;

  const errors: Record<string, string> = {};

  if (!CODE_PATTERN.test(code)) {
    errors.code = "Use de 3 a 20 letras/números, sem espaço.";
  }
  if (!(DISCOUNT_TYPES as readonly string[]).includes(typeRaw)) {
    errors.discountType = "Escolha o tipo de desconto.";
  }

  // Percentual é número inteiro de 1 a 100; fixo é dinheiro em centavos.
  let discountValue = 0;
  if (discountType === "percentage") {
    const percent = /^\d+$/.test(valueRaw) ? Number.parseInt(valueRaw, 10) : Number.NaN;
    if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
      errors.discountValue = "Percentual de 1 a 100.";
    } else {
      discountValue = percent;
    }
  } else {
    const cents = toCents(valueRaw);
    if (cents == null || cents < 1) {
      errors.discountValue = "Informe o valor do desconto.";
    } else {
      discountValue = cents;
    }
  }

  const minOrderCents = toCentsOrDefault(minOrderRaw, 0);
  if (minOrderCents == null) errors.minOrder = "Valor inválido.";

  let maxUsage: number | null = null;
  if (maxUsageRaw) {
    const parsed = /^\d+$/.test(maxUsageRaw) ? Number.parseInt(maxUsageRaw, 10) : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 1) {
      errors.maxUsage = "Deixe vazio pra ilimitado, ou informe 1 ou mais.";
    } else {
      maxUsage = parsed;
    }
  }

  const validFrom = parseDateInput(validFromRaw) ?? new Date();
  if (validFromRaw && !parseDateInput(validFromRaw)) errors.validFrom = "Data inválida.";

  let validUntil: Date | null = null;
  if (validUntilRaw) {
    const parsed = parseDateInput(validUntilRaw);
    if (!parsed) {
      errors.validUntil = "Data inválida.";
    } else if (parsed < validFrom) {
      errors.validUntil = "O fim não pode ser antes do início.";
    } else {
      // Fim do dia: cupom válido "até 21/10" vale o dia 21 inteiro.
      validUntil = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 23, 59, 59);
    }
  }

  return {
    errors,
    values: {
      code,
      description,
      discountType,
      discountValue,
      minOrderCents: minOrderCents ?? 0,
      maxUsage,
      validFrom,
      validUntil,
      isActive,
    },
  };
}
