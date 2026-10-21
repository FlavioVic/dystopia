/**
 * Testes da fila: deduplicação, concorrência (`FOR UPDATE SKIP LOCKED`),
 * backoff, dead-letter e reprocessamento.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import * as queue from "@/queue";
import { processOnce } from "@/queue/worker";
import { closeDatabase, resetDatabase } from "../helpers/db";

beforeEach(resetDatabase);
after(closeDatabase);

const future = (ms: number) => new Date(Date.now() + ms);
const past = (ms: number) => new Date(Date.now() - ms);

describe("enfileiramento", () => {
  it("grava o job com os padrões esperados", async () => {
    const enqueued = await queue.enqueue(db, { type: "teste.job", payload: { a: 1 } });
    assert.ok(enqueued);

    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, enqueued.id) });
    assert.equal(job?.status, "queued");
    assert.equal(job?.queue, "default");
    assert.equal(job?.attempts, 0);
    assert.equal(job?.maxAttempts, queue.DEFAULT_MAX_ATTEMPTS);
    assert.deepEqual(job?.payload, { a: 1 });
  });

  it("deduplica jobs ativos pela dedupe key", async () => {
    const first = await queue.enqueue(db, { type: "teste.job", dedupeKey: "chave-1" });
    const second = await queue.enqueue(db, { type: "teste.job", dedupeKey: "chave-1" });

    assert.ok(first);
    assert.equal(second, null, "o segundo enqueue é ignorado");
    assert.equal((await db.query.jobs.findMany()).length, 1);
  });

  it("libera a chave depois que o job termina", async () => {
    const first = await queue.enqueue(db, { type: "teste.job", dedupeKey: "chave-2" });
    await queue.complete(first!.id);

    const second = await queue.enqueue(db, { type: "teste.job", dedupeKey: "chave-2" });
    assert.ok(second, "com o anterior concluído, a chave pode ser reusada");
    assert.equal((await db.query.jobs.findMany()).length, 2);
  });

  it("jobs sem dedupe key não colidem entre si", async () => {
    await queue.enqueue(db, { type: "teste.job" });
    await queue.enqueue(db, { type: "teste.job" });
    assert.equal((await db.query.jobs.findMany()).length, 2);
  });
});

describe("claim", () => {
  it("pega o job pronto e marca como running com lease", async () => {
    const enqueued = await queue.enqueue(db, { type: "teste.job" });
    const claimed = await queue.claim({ workerId: "w1", leaseMs: 5_000 });

    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].id, enqueued!.id);
    assert.equal(claimed[0].attempts, 1, "a tentativa é contada no claim");

    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, enqueued!.id) });
    assert.equal(job?.status, "running");
    assert.equal(job?.lockedBy, "w1");
    assert.ok(job?.leaseUntil && job.leaseUntil.getTime() > Date.now());
  });

  it("não pega job agendado pro futuro", async () => {
    await queue.enqueue(db, { type: "teste.job", runAt: future(60_000) });
    assert.deepEqual(await queue.claim({ workerId: "w1" }), []);
  });

  it("respeita a fila pedida", async () => {
    await queue.enqueue(db, { type: "teste.job", queue: "emails" });
    assert.deepEqual(await queue.claim({ workerId: "w1" }), [], "fila default está vazia");

    const claimed = await queue.claim({ workerId: "w1", queues: ["emails"] });
    assert.equal(claimed.length, 1);
  });

  it("ordena pelo mais antigo e respeita o limite", async () => {
    const velho = await queue.enqueue(db, { type: "antigo", runAt: past(10_000) });
    await queue.enqueue(db, { type: "novo", runAt: past(1_000) });

    const claimed = await queue.claim({ workerId: "w1", limit: 1 });
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].id, velho!.id);
  });

  it("dois workers concorrentes nunca pegam o mesmo job (SKIP LOCKED)", async () => {
    await queue.enqueue(db, { type: "teste.job" });
    await queue.enqueue(db, { type: "teste.job" });

    const [a, b] = await Promise.all([
      queue.claim({ workerId: "w1", limit: 2 }),
      queue.claim({ workerId: "w2", limit: 2 }),
    ]);

    const ids = [...a, ...b].map((job) => job.id);
    assert.equal(ids.length, 2, "os dois jobs foram distribuídos");
    assert.equal(new Set(ids).size, 2, "sem job processado duas vezes");
  });

  it("com um job só, o segundo worker sai de mãos vazias", async () => {
    await queue.enqueue(db, { type: "teste.job" });

    const [a, b] = await Promise.all([
      queue.claim({ workerId: "w1" }),
      queue.claim({ workerId: "w2" }),
    ]);

    assert.equal(a.length + b.length, 1);
  });
});

describe("falha, backoff e dead-letter", () => {
  it("reagenda com atraso enquanto houver tentativa", async () => {
    const enqueued = await queue.enqueue(db, { type: "teste.job", maxAttempts: 3 });
    await queue.claim({ workerId: "w1" });

    const result = await queue.fail(enqueued!.id, "erro de teste");
    assert.equal(result.status, "failed");

    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, enqueued!.id) });
    assert.equal(job?.status, "failed");
    assert.equal(job?.attempts, 1);
    assert.equal(job?.lastError, "erro de teste");
    assert.ok(job!.runAt.getTime() > Date.now(), "próxima tentativa no futuro");
    assert.equal(job?.lockedBy, null, "lease devolvido");
  });

  it("vai pra dead-letter quando esgota as tentativas", async () => {
    const enqueued = await queue.enqueue(db, { type: "teste.job", maxAttempts: 2 });

    await queue.claim({ workerId: "w1" });
    assert.equal((await queue.fail(enqueued!.id, "1")).status, "failed");

    await db.update(jobs).set({ runAt: new Date() }).where(eq(jobs.id, enqueued!.id));
    await queue.claim({ workerId: "w1" });
    const second = await queue.fail(enqueued!.id, "2");

    assert.equal(second.status, "dead");
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, enqueued!.id) });
    assert.equal(job?.status, "dead");
    assert.ok(job?.finishedAt);
  });

  it("job já morto não é mais pego pelo claim", async () => {
    const enqueued = await queue.enqueue(db, { type: "teste.job", maxAttempts: 1 });
    await queue.claim({ workerId: "w1" });
    await queue.fail(enqueued!.id, "fatal");

    assert.deepEqual(await queue.claim({ workerId: "w2" }), []);
  });

  it("release devolve o job sem gastar tentativa", async () => {
    const enqueued = await queue.enqueue(db, { type: "teste.job" });
    await queue.claim({ workerId: "w1" });
    await queue.release(enqueued!.id, { delayMs: 0 });

    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, enqueued!.id) });
    assert.equal(job?.status, "queued");
    assert.equal(job?.attempts, 0, "a tentativa do claim foi desfeita");
  });

  it("truncamento: erro gigante não estoura a coluna", async () => {
    const enqueued = await queue.enqueue(db, { type: "teste.job", maxAttempts: 9 });
    await queue.claim({ workerId: "w1" });
    await queue.fail(enqueued!.id, "x".repeat(5_000));

    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, enqueued!.id) });
    assert.ok((job?.lastError?.length ?? 0) <= 2_001);
  });
});

describe("manutenção da fila", () => {
  it("devolve pra fila job travado por worker morto", async () => {
    const enqueued = await queue.enqueue(db, { type: "teste.job" });
    await queue.claim({ workerId: "w1", leaseMs: 1_000 });
    await db.update(jobs).set({ leaseUntil: past(5_000) }).where(eq(jobs.id, enqueued!.id));

    assert.equal(await queue.requeueExpiredLeases(), 1);
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, enqueued!.id) });
    assert.equal(job?.status, "queued");
    assert.equal(job?.lockedBy, null);
  });

  it("não mexe em job com lease válido", async () => {
    await queue.enqueue(db, { type: "teste.job" });
    await queue.claim({ workerId: "w1", leaseMs: 60_000 });
    assert.equal(await queue.requeueExpiredLeases(), 0);
  });

  it("reprocessa job da dead-letter zerando as tentativas", async () => {
    const enqueued = await queue.enqueue(db, { type: "teste.job", maxAttempts: 1 });
    await queue.claim({ workerId: "w1" });
    await queue.fail(enqueued!.id, "fatal");

    assert.equal(await queue.retryDeadJob(enqueued!.id), true);
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, enqueued!.id) });
    assert.equal(job?.status, "queued");
    assert.equal(job?.attempts, 0);
    assert.equal(job?.lastError, null);

    assert.equal(await queue.retryDeadJob(enqueued!.id), false, "só funciona em job morto");
  });

  it("settle fecha os jobs ativos de uma chave", async () => {
    await queue.enqueue(db, { type: "teste.job", dedupeKey: "chave-3" });
    assert.equal(await queue.settleByDedupeKey("chave-3"), 1);
    assert.equal(await queue.findActiveByDedupeKey("chave-3"), undefined);
  });

  it("schedule cria o job quando não existe nenhum ativo", async () => {
    const runAt = future(5_000);
    assert.equal(
      await queue.scheduleByDedupeKey("chave-4", { type: "teste.job", runAt }),
      "created",
    );
    assert.equal(
      await queue.scheduleByDedupeKey("chave-4", { type: "teste.job", runAt }),
      "rescheduled",
      "com job ativo, só reagenda",
    );
    assert.equal((await db.query.jobs.findMany()).length, 1);
  });
});

describe("worker", () => {
  it("manda pra fila de novo quando não existe handler pro tipo", async () => {
    const enqueued = await queue.enqueue(db, { type: "tipo.inexistente", maxAttempts: 2 });

    const report = await processOnce({ workerId: "w1" });
    assert.equal(report.claimed, 1);
    assert.equal(report.unknown, 1);

    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, enqueued!.id) });
    assert.equal(job?.status, "failed");
    assert.match(job?.lastError ?? "", /handler/);
  });

  it("não faz nada quando a fila está vazia", async () => {
    assert.deepEqual(await processOnce({ workerId: "w1" }), {
      claimed: 0,
      completed: 0,
      failed: 0,
      unknown: 0,
    });
  });
});
