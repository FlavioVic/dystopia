import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não está definida. Veja o arquivo .env.example.");
}

// Em serverless (Vercel) cada instância da função tem o próprio pool; com o
// padrão do `pg` (10) poucas instâncias já estouram o limite de conexões do
// Postgres. Lá use PG_POOL_MAX baixo; worker e dev ficam com o padrão.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX ?? 10),
});

export const db = drizzle(pool, { schema });

/** Pool do `pg` — exposto só para quem precisa encerrar conexões (scripts, testes). */
export const pgPool = pool;

export type Database = typeof db;

/** Transação do Drizzle (o `tx` de `db.transaction(async (tx) => ...)`). */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * "Quem executa a query": o pool ou uma transação. Os serviços recebem isso
 * em vez de importar `db` direto — é o que permite compor vários serviços
 * num único passo transacional da saga (e testar com rollback).
 */
export type Executor = Database | Transaction;
