/**
 * Menor privilégio: conectado como o usuário do app, dá para fazer o que a
 * loja faz (ler e gravar linha) e nada além — nem apagar tabela, nem criar,
 * nem esvaziar, nem ler o histórico de migrations. E a próxima migration já
 * nasce liberada para ele.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Client } from "pg";
import { applyAppRole, ensureAppRole } from "@/db/app-role";
import { closeDatabase, resetDatabase } from "../helpers/db";

// Papel é global no Postgres (vale para todos os bancos): nome próprio dos testes.
const ROLE = "dystopia_app_test";
const PASSWORD = randomBytes(24).toString("base64url");

const owner = new Client({ connectionString: process.env.DATABASE_URL });
let app: Client;

before(async () => {
  await resetDatabase();
  await owner.connect();
  await applyAppRole(owner, { role: ROLE, password: PASSWORD });
  const url = new URL(process.env.DATABASE_URL!);
  url.username = ROLE;
  url.password = PASSWORD;
  app = new Client({ connectionString: url.toString() });
  await app.connect();
});

after(async () => {
  await app?.end();
  await owner.query("drop table if exists app_role_probe");
  await owner.end();
  await closeDatabase();
});

/** Código de erro do Postgres (42501 = sem permissão). */
async function sqlState(query: string): Promise<string | undefined> {
  try {
    await app.query(query);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe("usuário do app (menor privilégio)", () => {
  it("lê, grava, altera e apaga linha — o que a loja faz", async () => {
    await app.query("insert into rate_limits (key, hits, window_started_at) values ('probe', 1, now())");
    await app.query("update rate_limits set hits = 2 where key = 'probe'");
    const { rows } = await app.query("select hits from rate_limits where key = 'probe'");
    assert.equal(rows[0].hits, 2);
    await app.query("delete from rate_limits where key = 'probe'");
    // Busca usa a função f_unaccent (migration 0008).
    await app.query("select f_unaccent('ação')");
  });

  it("não apaga, não altera, não esvazia e não cria tabela", async () => {
    assert.equal(await sqlState("drop table products"), "42501");
    assert.equal(await sqlState("alter table users add column hacked text"), "42501");
    assert.equal(await sqlState("truncate users"), "42501");
    assert.equal(await sqlState("create table hacked (id int)"), "42501");
    assert.equal(await sqlState("create function hacked() returns int language sql as 'select 1'"), "42501");
  });

  it("não lê o histórico de migrations nem cria papel", async () => {
    assert.equal(await sqlState("select * from drizzle.__drizzle_migrations"), "42501");
    assert.equal(await sqlState("create role hacked"), "42501");
  });

  it("tabela de migration futura já nasce liberada (privilégio padrão)", async () => {
    await owner.query("create table app_role_probe (id serial primary key, note text)");
    await app.query("insert into app_role_probe (note) values ('ok')");
    const { rows } = await app.query("select note from app_role_probe");
    assert.equal(rows[0].note, "ok");
    assert.equal(await sqlState("drop table app_role_probe"), "42501");
  });

  it("rodar de novo só reaplica (idempotente) e troca a senha", async () => {
    assert.deepEqual(await applyAppRole(owner, { role: ROLE, password: PASSWORD }), { created: false });
  });

  it("sem senha, só reaplica os GRANTs (banco novo no mesmo servidor) — e não cria papel", async () => {
    assert.deepEqual(await applyAppRole(owner, { role: ROLE }), { created: false });
    await assert.rejects(applyAppRole(owner, { role: "papel_que_nao_existe" }), /não existe/);
  });

  it("recusa senha curta e nome de papel com SQL dentro", async () => {
    await assert.rejects(applyAppRole(owner, { role: ROLE, password: "curta" }), /16\+ caracteres/);
    await assert.rejects(applyAppRole(owner, { role: 'x"; drop table users; --', password: PASSWORD }), /nome de papel inválido/);
  });
});

describe("papel do app com dono que não é superusuário (como no Neon)", () => {
  // No Neon o dono do banco tem CREATEROLE, mas não é superusuário — e o
  // Postgres só deixa mexer em SUPERUSER/REPLICATION/BYPASSRLS de outro papel
  // quem tem o atributo. Trocar a senha não pode esbarrar nisso.
  const NEON_OWNER = "dono_tipo_neon_test";
  const NEON_APP = "app_tipo_neon_test";
  const OWNER_PASSWORD = randomBytes(24).toString("base64url");
  let neonOwner: Client;

  before(async () => {
    await owner.query(`drop role if exists ${NEON_APP}`);
    await owner.query(`drop role if exists ${NEON_OWNER}`);
    await owner.query(`create role ${NEON_OWNER} login createrole password '${OWNER_PASSWORD}'`);
    const url = new URL(process.env.DATABASE_URL!);
    url.username = NEON_OWNER;
    url.password = OWNER_PASSWORD;
    neonOwner = new Client({ connectionString: url.toString() });
    await neonOwner.connect();
  });

  after(async () => {
    await neonOwner?.end();
    await owner.query(`drop owned by ${NEON_APP}`).catch(() => {});
    await owner.query(`drop role if exists ${NEON_APP}`);
    await owner.query(`drop role if exists ${NEON_OWNER}`);
  });

  it("cria o papel e depois troca a senha, sem pedir atributo de superusuário", async () => {
    assert.deepEqual(await ensureAppRole(neonOwner, { role: NEON_APP, password: PASSWORD }), { created: true });
    assert.deepEqual(await ensureAppRole(neonOwner, { role: NEON_APP, password: `${PASSWORD}-nova` }), { created: false });

    const url = new URL(process.env.DATABASE_URL!);
    url.username = NEON_APP;
    url.password = `${PASSWORD}-nova`;
    const rotated = new Client({ connectionString: url.toString() });
    await rotated.connect();
    assert.equal((await rotated.query("select current_user as who")).rows[0].who, NEON_APP, "entra com a senha nova");
    await rotated.end();
  });

  it("papel que já existe com privilégio a mais é recusado, não silenciosamente aceito", async () => {
    await owner.query(`alter role ${NEON_APP} createdb`);
    await assert.rejects(ensureAppRole(neonOwner, { role: NEON_APP, password: PASSWORD }), /privilégio a mais/);
    await owner.query(`alter role ${NEON_APP} nocreatedb`);
  });
});
