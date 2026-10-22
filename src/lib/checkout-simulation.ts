/**
 * Modo demonstração do checkout: deixa quem está comprando escolher o
 * resultado do gateway simulado (recusar, instável, fora do ar) pra ver a
 * saga compensar ou tentar de novo.
 *
 * Seguro aqui porque o gateway é de mentira — nada é cobrado em nenhum dos
 * caminhos. Com um gateway real isso tem que ficar desligado: o cliente não
 * pode escolher o resultado da própria cobrança.
 *
 * Mora fora de `lib/actions` porque arquivo "use server" só exporta função
 * async, e a página e a action precisam ler a mesma flag.
 */
export function isCheckoutSimulationEnabled(): boolean {
  return process.env.ALLOW_CHECKOUT_SIMULATION === "1";
}
