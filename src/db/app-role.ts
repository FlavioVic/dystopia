/**
 * Usuário de banco do app, com o mínimo: lê e grava linha, não mexe em
 * schema. Se alguém achar uma injeção de SQL ou levar a `DATABASE_URL` do
 * deploy, não apaga tabela, não cria função, não lê a tabela de migrations.
 *
 * Quem cria tabela é o DONO do banco (migrations, seed) — outra conexão,
 * que nunca vai para o runtime do app. Os privilégios padrão (`ALTER DEFAULT
 * PRIVILEGES`) fazem as tabelas das migrations futuras já nascerem liberadas
 * para o app, sem rodar isto de novo.
 *
 * No Neon, o papel tem que nascer por SQL (aqui): papel criado pelo console
 * ou pela CLI entra no `neon_superuser` e ganha muito mais do que isto.
 */

import type { ClientBase } from "pg";

export const APP_ROLE = "dystopia_app";

/** Só identificador simples: o nome vai direto no SQL (identificador não tem parâmetro). */
function quoteIdentifier(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`nome de papel inválido: ${name}`);
  return `"${name}"`;
}

/**
 * Cria o papel (ou troca a senha, se já existe) e reaplica os GRANTs.
 * Idempotente. Rodar conectado como o dono do schema `public`.
 */
export async function applyAppRole(
  client: ClientBase,
  options: { password: string; role?: string },
): Promise<{ created: boolean }> {
  const role = quoteIdentifier(options.role ?? APP_ROLE);
  // O Neon exige 60 bits de entropia na senha de papel criado por SQL.
  if (options.password.length < 16) throw new Error("a senha do papel do app precisa de 16+ caracteres (openssl rand -base64 24)");
  const password = client.escapeLiteral(options.password);

  const existing = await client.query("select 1 from pg_roles where rolname = $1", [options.role ?? APP_ROLE]);
  const created = existing.rowCount === 0;
  // Atributos explícitos: nada de superusuário, criar banco/papel, replicação ou furar RLS.
  const attributes = "login nosuperuser nocreatedb nocreaterole noreplication nobypassrls";
  await client.query(created
    ? `create role ${role} ${attributes} password ${password}`
    : `alter role ${role} ${attributes} password ${password}`);

  const { rows } = await client.query<{ db: string }>("select current_database() as db");
  const database = client.escapeIdentifier(rows[0].db);

  await client.query(`grant connect on database ${database} to ${role}`);
  // Postgres < 15 deixava qualquer papel criar objeto no `public`; o 15+ já
  // não deixa, e isto garante o mesmo nos dois.
  await client.query("revoke create on schema public from public");
  await client.query(`grant usage on schema public to ${role}`);
  await client.query(`grant select, insert, update, delete on all tables in schema public to ${role}`);
  await client.query(`grant usage, select on all sequences in schema public to ${role}`);
  // Tabelas das próximas migrations (criadas por quem roda isto) já nascem liberadas.
  await client.query(`alter default privileges in schema public grant select, insert, update, delete on tables to ${role}`);
  await client.query(`alter default privileges in schema public grant usage, select on sequences to ${role}`);
  return { created };
}
