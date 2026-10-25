/**
 * Modo demonstração do checkout: deixa quem está comprando escolher o
 * resultado do gateway simulado (recusar, instável, fora do ar) para ver a
 * saga compensar ou tentar de novo.
 *
 * Seguro aqui porque nada é cobrado de verdade: o provedor simulado não cobra
 * e o Stripe só aceita chave de teste; a falha é injetada antes do provedor.
 * Com cobrança real (chave de produção) isso tem que ficar desligado: o
 * cliente não pode escolher o resultado da própria cobrança.
 *
 * Mora fora de `lib/actions` porque arquivo "use server" só exporta função
 * async, e a página e a action precisam ler a mesma flag.
 */
export function isCheckoutSimulationEnabled(): boolean {
  return process.env.ALLOW_CHECKOUT_SIMULATION === "1";
}
