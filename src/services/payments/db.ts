import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Conexão com o banco do serviço de pagamentos — só `services/payments` (e
 * quem monta processo: scripts, composição) usa isto.
 *
 * Banco próprio de verdade: apontar para o mesmo banco da loja juntaria de
 * novo as duas outboxes e as duas tabelas `payments` — então é recusado.
 */

const url = process.env.PAYMENTS_DATABASE_URL;
if (!url) {
  throw new Error("PAYMENTS_DATABASE_URL não está definida: pagamentos tem banco próprio. Veja o .env.example.");
}
if (sameDatabase(url, process.env.DATABASE_URL)) {
  throw new Error("PAYMENTS_DATABASE_URL aponta para o mesmo banco da loja (DATABASE_URL): pagamentos precisa de banco próprio.");
}

const pool = new Pool({
  connectionString: url,
  max: Number(process.env.PG_POOL_MAX ?? 10),
  // Banco que não responde (host errado, rede fora) falha em 10 s em vez de
  // segurar o request ou o dreno da fila até o timeout do TCP (minutos). Dá
  // folga para o Neon acordar do scale-to-zero.
  connectionTimeoutMillis: 10_000,
});

export const paymentsDb = drizzle(pool, { schema });

/** Pool do `pg` — exposto só para quem precisa encerrar conexões (scripts, testes). */
export const paymentsPool = pool;

export type PaymentsDatabase = typeof paymentsDb;
export type PaymentsTransaction = Parameters<Parameters<PaymentsDatabase["transaction"]>[0]>[0];
export type PaymentsExecutor = PaymentsDatabase | PaymentsTransaction;

function sameDatabase(a: string, b: string | undefined): boolean {
  if (!b) return false;
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.host === right.host && left.pathname === right.pathname;
  } catch {
    return false;
  }
}
