/**
 * Cria/atualiza o usuário de banco do app: `npm run db:app-role`.
 *
 * Roda com a conexão do DONO (a mesma das migrations), depois de migrar:
 *
 *   APP_DB_PASSWORD="$(openssl rand -base64 24)" npm run db:app-role
 *
 * Sem `APP_DB_PASSWORD`, o papel tem que existir e só os GRANTs são aplicados
 * (a senha fica como está).
 *
 * Aplica nos dois bancos (`DATABASE_URL` e `PAYMENTS_DATABASE_URL`). Depois o
 * app (e os workers) passam a usar
 * `postgresql://dystopia_app:<APP_DB_PASSWORD>@<host>/<banco>` nas duas URLs.
 * Passo a passo de produção em docs/DEPLOY.md.
 */

import "dotenv/config";
import { Client } from "pg";
import { APP_ROLE, applyAppRole } from "@/db/app-role";

async function main(): Promise<void> {
  // Sem APP_DB_PASSWORD: só os GRANTs, com o papel já existente (ex.: liberar
  // o banco novo de pagamentos sem trocar a senha que o deploy já usa).
  const password = process.env.APP_DB_PASSWORD || undefined;

  // Os dois bancos: o papel é do servidor (um só), mas os GRANTs são por banco.
  const targets = [
    { label: "loja", url: process.env.DATABASE_URL },
    { label: "pagamentos", url: process.env.PAYMENTS_DATABASE_URL },
  ];
  for (const target of targets) {
    if (!target.url) throw new Error(`Defina a URL do banco (${target.label}).`);
    const client = new Client({ connectionString: target.url });
    await client.connect();
    try {
      const { created } = await applyAppRole(client, { password });
      console.log(
        `✅ ${target.label}: papel ${APP_ROLE} ${created ? "criado" : "atualizado"} (só SELECT/INSERT/UPDATE/DELETE no schema public).`,
      );
    } finally {
      await client.end();
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
