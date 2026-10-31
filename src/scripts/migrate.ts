/**
 * Migrations dos dois bancos: `npm run db:migrate`.
 *
 * - `DATABASE_URL` → banco da loja, migrations de `drizzle/`;
 * - `PAYMENTS_DATABASE_URL` → banco de pagamentos, migrations de
 *   `drizzle-payments/` (cada banco guarda o próprio histórico).
 *
 * Rodar com a conexão do DONO dos bancos (a do app não cria tabela). Com
 * `PAYMENTS_DATABASE_CREATE=1`, cria o banco de pagamentos se ele não
 * existir (stack local e CI); em produção ele é criado à mão, uma vez.
 */

import "dotenv/config";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const ROOT = path.resolve(import.meta.dirname, "../..");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Defina ${name}.`);
  return value;
}

async function ensureDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.replace(/^\//, ""));
  if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error(`nome de banco inválido: ${name}`);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const pool = new Pool({ connectionString: admin.toString() });
  try {
    const existing = await pool.query("select 1 from pg_database where datname = $1", [name]);
    if (existing.rowCount === 0) {
      await pool.query(`create database "${name}"`);
      console.log(`🗄️  banco criado: ${name}`);
    }
  } finally {
    await pool.end();
  }
}

async function migrateDatabase(label: string, url: string, folder: string): Promise<void> {
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.join(ROOT, folder) });
    console.log(`✅ ${label}: migrations de ${folder}/ aplicadas.`);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const shop = required("DATABASE_URL");
  const payments = required("PAYMENTS_DATABASE_URL");
  if (process.env.PAYMENTS_DATABASE_CREATE === "1") await ensureDatabase(payments);

  await migrateDatabase("loja", shop, "drizzle");
  await migrateDatabase("pagamentos", payments, "drizzle-payments");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
