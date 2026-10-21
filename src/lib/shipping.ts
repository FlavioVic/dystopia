// Constantes/helpers puros do checkout — separados das Server Actions porque
// um arquivo "use server" só pode exportar funções async.

export const FLAT_SHIPPING_CENTS = 1990;
export const FREE_SHIPPING_MIN_CENTS = 14990;

export function shippingFor(subtotalCents: number): number {
  return subtotalCents >= FREE_SHIPPING_MIN_CENTS ? 0 : FLAT_SHIPPING_CENTS;
}

export type CouponResult = {
  ok: boolean;
  code?: string;
  couponId?: string;
  discountCents?: number;
  message: string;
};
