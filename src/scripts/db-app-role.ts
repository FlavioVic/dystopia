/**
 * Cria/atualiza o usuário de banco do app: `npm run db:app-role`.
 *
 * Roda com a conexão do DONO (a mesma das migrations), depois de migrar:
 *
 *   APP_DB_PASSWORD="$(openssl rand -base64 24)" npm run db:app-role
 *
 * Depois o app (e o worker) passam a usar
 * `postgresql://dystopia_app:<APP_DB_PASSWORD>@<host>/<banco>` no
 * `DATABASE_URL`. Passo a passo de produção em docs/DEPLOY.md.
 */

import "dotenv/config";
import { Client } from "pg";
import { APP_ROLE, applyAppRole } from "@/db/app-role";

async function main(): Promise<void> {
  const password = process.env.APP_DB_PASSWORD;
  if (!password) throw new Error("Defina APP_DB_PASSWORD (gere com `openssl rand -base64 24`).");

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { created } = await applyAppRole(client, { password });
    console.log(`✅ papel ${APP_ROLE} ${created ? "criado" : "atualizado"} (só SELECT/INSERT/UPDATE/DELETE no schema public).`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
