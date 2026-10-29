/**
 * Limites das Server Actions que não são login/cadastro/orçamento/assistente
 * (esses têm a regra ao lado do código). Server Action é endpoint público:
 * sem limite, uma conta só faria pedido simulado em loop (zera o estoque e
 * gasta a cota de e-mail), testaria código de cupom à vontade ou criaria um
 * carrinho por chamada.
 *
 * Por usuário quando a ação exige login (trocar de IP não ajuda); por IP
 * quando não exige. Os números mudam por variável só na stack de teste.
 */

import { db } from "@/db";
import { limitFromEnv } from "@/lib/rate-limit-config";
import { consumeRateLimit, type RateLimitRule } from "@/services/rate-limit";

export const ACTION_LIMITS = {
  checkout: { limit: limitFromEnv("CHECKOUT_LIMIT_PER_HOUR", 5), windowSeconds: 60 * 60 },
  coupon: { limit: limitFromEnv("COUPON_LIMIT_PER_10MIN", 30), windowSeconds: 10 * 60 },
  cart: { limit: limitFromEnv("CART_LIMIT_PER_10MIN", 60), windowSeconds: 10 * 60 },
  review: { limit: limitFromEnv("REVIEW_LIMIT_PER_HOUR", 10), windowSeconds: 60 * 60 },
  wishlist: { limit: limitFromEnv("WISHLIST_LIMIT_PER_10MIN", 60), windowSeconds: 10 * 60 },
  // Exclusão pede a senha de novo: sem limite, viraria força bruta por dentro da sessão.
  accountDelete: { limit: 5, windowSeconds: 60 * 60 },
  // Código do autenticador (login, cadastro, códigos novos). Duas janelas: a
  // curta segura a rajada, a diária é a que faz o chute levar anos.
  mfa: { limit: limitFromEnv("MFA_LIMIT_PER_15MIN", 5), windowSeconds: 15 * 60 },
  mfaDaily: { limit: limitFromEnv("MFA_LIMIT_PER_DAY", 20), windowSeconds: 24 * 60 * 60 },
} satisfies Record<string, RateLimitRule>;

export type LimitedAction = keyof typeof ACTION_LIMITS;

export function retryMessage(retryAfterSeconds: number): string {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return `Muitas tentativas. Tente de novo em ${minutes} ${minutes === 1 ? "minuto" : "minutos"}.`;
}

/**
 * Conta uma tentativa de `action` para `subject` (`user:<id>` ou `ip:<ip>`).
 * Devolve a mensagem para a pessoa quando passou do limite, ou `null`.
 */
export async function limitAction(action: LimitedAction, subject: string): Promise<string | null> {
  const { allowed, retryAfterSeconds } = await consumeRateLimit(db, `${action}:${subject}`, ACTION_LIMITS[action]);
  return allowed ? null : retryMessage(retryAfterSeconds);
}
