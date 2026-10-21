/**
 * Runner dos testes: `npm test` (tudo) ou `npm run test:unit` (só o que não
 * precisa de banco).
 *
 * O que ele faz antes de rodar:
 * 1. calcula a URL do banco de teste (`dystopia_test`, derivado do
 *    DATABASE_URL de dev — ver tests/helpers/env.ts);
 * 2. cria o banco se não existir e aplica as migrations;
 * 3. aponta `DATABASE_URL` pro banco de teste e passa `--import tsx` pros
 *    processos filhos (o node:test roda cada arquivo num processo próprio, e
 *    eles precisam do loader pra entender TypeScript e o alias `@/`).
 *
 * Os arquivos de integração rodam em série (`concurrency: 1`): eles
 * compartilham o mesmo banco e limpam as tabelas entre os casos.
 */

import { readdirSync } from "node:fs";
import path from "node:path";
import { run } from "node:test";
import { spec } from "node:test/reporters";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { adminDatabaseUrl, testDatabaseName, testDatabaseUrl } from "./helpers/env";

const ROOT = path.resolve(import.meta.dirname, "..");
const unitOnly = process.argv.includes("--unit");

function testFiles(dir: string): string[] {
  const absolute = path.join(ROOT, "tests", dir);
  return readdirSync(absolute)
    .filter((file) => file.endsWith(".test.ts"))
    .sort()
    .map((file) => path.join(absolute, file));
}

async function ensureTestDatabase(): Promise<void> {
  const name = testDatabaseName();
  const admin = new Pool({ connectionString: adminDatabaseUrl() });

  try {
    const existing = await admin.query("select 1 from pg_database where datname = $1", [name]);
    if (existing.rowCount === 0) {
      // Nome vem do próprio DATABASE_URL (não de entrada de usuário), mas
      // ainda assim só aceitamos identificador simples.
      if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error(`Nome de banco inválido: ${name}`);
      await admin.query(`create database "${name}"`);
      console.log(`🗄️  banco de teste criado: ${name}`);
    }
  } finally {
    await admin.end();
  }

  const pool = new Pool({ connectionString: testDatabaseUrl() });
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.join(ROOT, "drizzle") });
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const files = unitOnly ? testFiles("unit") : [...testFiles("unit"), ...testFiles("integration")];

  if (!unitOnly) {
    await ensureTestDatabase();
  }

  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.NODE_OPTIONS = ["--import", "tsx", process.env.NODE_OPTIONS ?? ""].join(" ").trim();
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "error";

  let failures = 0;
  const stream = run({ files, concurrency: 1, timeout: 120_000 });
  stream.on("test:fail", (event) => {
    // Subtestes falhos aparecem junto do arquivo; conta só o que não é suíte.
    if (!event.todo && !event.skip) failures += 1;
  });
  stream.compose(new spec()).pipe(process.stdout);

  await new Promise<void>((resolve) => stream.on("end", resolve));
  if (failures > 0) {
    console.error(`\n❌ ${failures} teste(s) falharam.`);
    process.exit(1);
  }
  console.log("\n✅ suíte verde.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
