/**
 * Limite por IP vindo do ambiente, com o valor de produção como padrão. Só a
 * stack de teste (docker compose) muda: os testes de navegador fazem vários
 * cadastros e pedidos do mesmo IP. Valor inválido cai no padrão.
 */
export function limitFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
