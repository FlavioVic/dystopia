/**
 * Isolamento entre as outboxes (bulkhead). Incidente de 2026-10-31: a URL do
 * banco de pagamentos quebrada fazia o relay LANÇAR antes do dreno, e todo
 * checkout ficava em "processando" — inclusive o que só dependia da loja.
 * Aqui o banco quebrado é de verdade (porta fechada em 127.0.0.1): o `pg`
 * falha ao conectar, como falhou em produção.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { db } from "@/db";
import { outbox } from "@/db/schema";
import { enqueue } from "@/queue";
import { purgeQueues } from "@/queue/broker";
import { getQueueMetrics } from "@/queue/metrics";
import { createRelay, relayAll, type NamedOutbox, type OutboxDatabase } from "@/queue/relay";
import { drainQueues } from "@/queue/worker";
import { closeDatabase, resetDatabase } from "../helpers/db";

const Q = "teste-isolamento";

const storeOutbox: NamedOutbox = { name: "loja", database: db };

// Ninguém escuta na porta 1: conexão recusada na hora, sem esperar timeout.
const deadPool = new Pool({ connectionString: "postgres://ninguem:x@127.0.0.1:1/nada", connectionTimeoutMillis: 1_000 });
const deadOutbox: NamedOutbox = { name: "pagamentos", database: drizzle(deadPool) };

beforeEach(async () => {
  await resetDatabase();
  await purgeQueues([Q]);
});
after(async () => {
  await deadPool.end();
  await closeDatabase();
});

const pendingInStore = async () => (await db.select().from(outbox)).filter((row) => row.publishedAt === null).length;

describe("isolamento entre outboxes", () => {
  it("o banco de uma outbox fora não impede a outra de publicar", async (t) => {
    const errors = t.mock.method(console, "error", () => {});
    await enqueue(db, { type: "teste.noop", queue: Q });

    // A quebrada vem PRIMEIRO de propósito: antes, ela levava a da loja junto.
    const report = await relayAll([deadOutbox, storeOutbox]);

    assert.deepEqual(report, { published: 1, failed: 0, unreachable: ["pagamentos"] });
    assert.equal(await pendingInStore(), 0, "a mensagem da loja chegou ao broker");
    assert.equal(errors.mock.callCount(), 1, "a queda vira uma linha de erro");
    const line = String(errors.mock.calls[0].arguments[0]);
    assert.match(line, /outbox inacessível.*pagamentos/);
    assert.match(line, /ECONNREFUSED/, "diz a causa, não o SQL que o Drizzle embrulhou");
  });

  it("o dreno segue consumindo com uma outbox fora (o caso do incidente)", async (t) => {
    t.mock.method(console, "error", () => {});
    await enqueue(db, { type: "teste.noop", queue: Q });

    let handled = 0;
    const report = await drainQueues({
      outboxes: [deadOutbox, storeOutbox],
      queues: [Q],
      budgetMs: 5_000,
      handlers: { "teste.noop": async () => void (handled += 1) },
    });

    assert.equal(handled, 1, "a mensagem da loja foi publicada e consumida no mesmo dreno");
    assert.equal(report.acked, 1);
  });

  it("outbox fora fica de fora pelo backoff e só loga na queda e na volta", async (t) => {
    // O runner sobe com LOG_LEVEL=error; a volta é info.
    const level = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "info";
    t.after(() => {
      process.env.LOG_LEVEL = level;
    });
    const errors = t.mock.method(console, "error", () => {});
    const infos = t.mock.method(console, "info", () => {});
    let attempts = 0;
    let healthy = false;
    // Só o que o relay chama: `transaction`. Fora do ar, nem conecta.
    const flaky = {
      transaction: async () => {
        attempts += 1;
        if (!healthy) throw new Error("getaddrinfo ENOTFOUND base");
        return { published: 0, failed: 0 };
      },
    } as unknown as OutboxDatabase;
    let now = 0;
    const relay = createRelay([{ name: "pagamentos", database: flaky }], { clock: () => now });

    assert.deepEqual((await relay()).unreachable, ["pagamentos"]);
    now += 200;
    assert.deepEqual((await relay()).unreachable, ["pagamentos"], "na pausa continua contando como fora");
    now += 200;
    await relay();
    assert.equal(attempts, 1, "na pausa (1 s ± 20%) nem tenta conectar");

    now += 1_000;
    await relay();
    assert.equal(attempts, 2, "passou a pausa: tenta de novo");
    assert.equal(errors.mock.callCount(), 1, "segunda falha da mesma queda não repete o erro");

    healthy = true;
    now += 3_000; // 2ª pausa: 2 s ± 20%
    assert.deepEqual(await relay(), { published: 0, failed: 0, unreachable: [] });
    assert.equal(infos.mock.callCount(), 1);
    assert.match(String(infos.mock.calls[0].arguments[0]), /outbox voltou a responder/);

    now += 1;
    await relay();
    assert.equal(attempts, 4, "de volta: sem pausa");
  });

  it("o painel mede as outboxes que respondem e aponta a que não responde", async () => {
    await enqueue(db, { type: "teste.noop", queue: Q });

    const metrics = await getQueueMetrics(db, { queues: [Q], outboxes: [storeOutbox, deadOutbox] });

    assert.equal(metrics.outbox.pending, 1, "a da loja continua medida");
    assert.deepEqual(
      metrics.outboxesDown.map((down) => down.name),
      ["pagamentos"],
    );
    assert.match(metrics.outboxesDown[0].error, /ECONNREFUSED/, "a causa, não o SQL que o Drizzle embrulhou");
    assert.equal(metrics.broker.status, "up", "o resto da leitura segue normal");
  });
});
