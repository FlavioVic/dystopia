/**
 * Migrations que transformam DADO (não só schema) contra um banco com dados
 * no formato antigo: aplica até a anterior, insere o que existiria em
 * produção, aplica a migration e confere o resultado. Banco próprio e
 * descartável — não encosta no de teste nem no de dev.
 */

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { adminDatabaseUrl, testDatabaseName, testDatabaseUrl } from "../helpers/env";

const ROOT = path.resolve(import.meta.dirname, "../..");
const NAME = `${testDatabaseName()}_migracoes`;
const url = (() => {
  const value = new URL(testDatabaseUrl());
  value.pathname = `/${NAME}`;
  return value.toString();
})();

let pool: Pool;
const tempDirs: string[] = [];

/** Pasta de migrations só com as anteriores a `tag` (prefixo "0006"…). */
function migrationsBefore(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "dystopia-migracoes-"));
  tempDirs.push(dir);
  cpSync(path.join(ROOT, "drizzle"), dir, { recursive: true });
  const journalPath = path.join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((entry) => entry.tag < prefix);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

async function recreateDatabase(): Promise<void> {
  if (!/^[a-zA-Z0-9_]+$/.test(NAME)) throw new Error(`nome inválido: ${NAME}`);
  await pool?.end();
  const admin = new Pool({ connectionString: adminDatabaseUrl() });
  try {
    await admin.query(`drop database if exists "${NAME}" with (force)`);
    await admin.query(`create database "${NAME}"`);
  } finally {
    await admin.end();
  }
  pool = new Pool({ connectionString: url });
}

const migrateUntil = (prefix: string) => migrate(drizzle(pool), { migrationsFolder: migrationsBefore(prefix) });
const migrateAll = () => migrate(drizzle(pool), { migrationsFolder: path.join(ROOT, "drizzle") });

/** Categoria + produto mínimos (os carrinhos e pedidos precisam). */
async function seedProduct(): Promise<string> {
  const { rows: [category] } = await pool.query(
    "insert into categories (name, slug) values ('C', 'c') returning id",
  );
  const { rows: [product] } = await pool.query(
    `insert into products (category_id, name, slug, description, sku, price_cents, stock_quantity)
     values ($1, 'P', 'p', 'd', 'SKU-1', 1000, 10) returning id`,
    [category.id],
  );
  return product.id;
}

before(recreateDatabase);
after(async () => {
  await pool.end();
  const admin = new Pool({ connectionString: adminDatabaseUrl() });
  await admin.query(`drop database if exists "${NAME}" with (force)`);
  await admin.end();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("migration 0006 — fila em tabela → outbox", () => {
  it("o que estava em voo vira mensagem da outbox, com fila e resposta renomeadas", async () => {
    await recreateDatabase();
    await migrateUntil("0006");

    const replyTo = { type: "saga.reply", queue: "default", payload: { sagaId: "s-1", step: "authorize-payment", phase: "invoke" }, dedupeKey: "k" };
    await pool.query(
      `insert into jobs (queue, type, payload, status, run_at, max_attempts) values
        ('payments', 'payments.authorize', $1, 'queued', now(), 3),
        ('default', 'saga.reply', '{"sagaId":"s-2"}', 'failed', now() + interval '30 seconds', 5),
        ('default', 'notifications.deliver', '{"notificationId":"n-1"}', 'running', now(), 5),
        ('default', 'saga.advance', '{"sagaId":"s-3"}', 'done', now(), 5),
        ('default', 'saga.advance', '{"sagaId":"s-4"}', 'dead', now(), 5),
        ('default', 'saga.reconcile', '{}', 'queued', now(), 5)`,
      [JSON.stringify({ orderId: "o-1", replyTo })],
    );

    await migrateAll();

    const { rows } = await pool.query("select queue, type, payload, max_attempts, delay_ms from outbox order by type");
    assert.deepEqual(
      rows.map((row) => [row.queue, row.type]),
      [
        ["notifications", "notifications.deliver"],
        ["payments", "payments.authorize"],
        ["saga", "saga.reply"],
      ],
      "concluído, morto e reconcile não entram",
    );
    const command = rows.find((row) => row.type === "payments.authorize");
    assert.deepEqual(command.payload.replyTo, { type: "saga.reply", queue: "saga", payload: replyTo.payload });
    assert.equal(command.max_attempts, 3);
    const retry = rows.find((row) => row.type === "saga.reply");
    assert.ok(retry.delay_ms > 25_000 && retry.delay_ms <= 30_000, "retry agendado mantém o atraso");

    const { rows: [jobs] } = await pool.query("select to_regclass('jobs') as t");
    assert.equal(jobs.t, null, "a tabela antiga foi apagada");
  });
});

describe("migration 0007 — carrinho sem linha duplicada", () => {
  it("junta as duplicatas (soma com teto de 10) antes de criar a restrição", async () => {
    await recreateDatabase();
    await migrateUntil("0007");
    const productId = await seedProduct();
    const { rows: [cart] } = await pool.query("insert into carts (session_token) values ('t') returning id");
    await pool.query(
      `insert into cart_items (cart_id, product_id, variant_id, quantity, unit_price_cents, created_at) values
        ($1, $2, null, 2, 1000, now() - interval '3 minutes'),
        ($1, $2, null, 3, 1000, now() - interval '2 minutes'),
        ($1, $2, null, 9, 1000, now() - interval '1 minute')`,
      [cart.id, productId],
    );

    await migrateAll();

    const { rows } = await pool.query("select quantity from cart_items");
    assert.deepEqual(rows, [{ quantity: 10 }]);
    await assert.rejects(
      pool.query("insert into cart_items (cart_id, product_id, variant_id, quantity, unit_price_cents) values ($1, $2, null, 1, 1000)", [cart.id, productId]),
      /cart_items_cart_product_variant_unique/,
      "variant_id NULL agora conta como repetido",
    );
  });
});
