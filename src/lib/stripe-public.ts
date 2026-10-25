import { createLogger } from "@/lib/logger";

const logger = createLogger("stripe");

/**
 * Chave PÚBLICA do Stripe, a única que o app web conhece — a secreta mora só
 * no processo de pagamentos. Sem ela, cartão segue no provedor simulado.
 *
 * Lida em runtime (não `NEXT_PUBLIC_*`): trocar a chave não exige rebuild, e
 * a página do checkout passa o valor para o formulário.
 */
export function getStripePublishableKey(): string | null {
  const key = process.env.STRIPE_PUBLISHABLE_KEY?.trim();
  if (!key) return null;
  if (!key.startsWith("pk_test_")) {
    // Chave de produção num projeto de demonstração: desliga o cartão em vez
    // de derrubar o checkout inteiro (o processo de pagamentos também recusa).
    logger.error("STRIPE_PUBLISHABLE_KEY ignorada: precisa ser de modo de teste (pk_test_…)");
    return null;
  }
  return key;
}
