/**
 * Fila: outbox no Postgres + RabbitMQ de verdade (prefixo de teste, filas de
 * espera de 50–400 ms). Cada caso é uma regra da política de entrega e de
 * retentativa — o que o resto do sistema assume que a fila garante.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { outbox } from "@/db/schema";
import { enqueue, type QueueMessage } from "@/queue";
import {
  closeBroker,
  getBroker,
  HEADER_ATTEMPTS,
  HEADER_ERROR,
  names,
  purgeQueues,
  queueDepths,
  retryTierFor,
} from "@/queue/broker";
import { peekDeadLetters, replayDeadLetters } from "@/queue/dead-letters";
import { relayOutbox } from "@/queue/relay";
import { drainQueues, startWorker, type Handlers } from "@/queue/worker";
import { PermanentError, RetryableError } from "@/shared/errors";
import { closeDatabase, resetDatabase } from "../helpers/db";

const Q = "teste";

beforeEach(async () => {
  await resetDatabase();
  await purgeQueues([Q]);
});
after(closeDatabase);

async function depth() {
  const [d] = await queueDepths([Q]);
  return { ready: d.ready, retrying: d.retrying, dead: d.dead };
}

/** Handler que registra cada entrega e responde conforme `behave`. */
function recorder(behave: (message: QueueMessage) => Promise<unknown> | unknown = () => undefined) {
  const seen: QueueMessage[] = [];
  const handlers: Handlers = {
    "teste.job": async (message) => {
      seen.push(message);
      const result = await behave(message);
      return result as void;
    },
  };
  return { seen, handlers };
}

const drain = (handlers: Handlers, waitForScheduled = false) =>
  drainQueues({ outboxes: [db], queues: [Q], handlers, budgetMs: 5_000, waitForScheduled });

describe("outbox", () => {
  it("grava a mensagem com os padrões e não publica nada sozinha", async () => {
    const { id } = await enqueue(db, { type: "teste.job", queue: Q, payload: { a: 1 } });
    const row = await db.query.outbox.findFirst({ where: eq(outbox.id, id) });
    assert.equal(row?.maxAttempts, 5);
    assert.equal(row?.delayMs, 0);
    assert.equal(row?.publishedAt, null, "só o relay publica");
    assert.deepEqual(await depth(), { ready: 0, retrying: 0, dead: 0 });
  });

  it("transação desfeita não deixa mensagem: fato e mensagem são atômicos", async () => {
    await assert.rejects(
      db.transaction(async (tx) => {
        await enqueue(tx, { type: "teste.job", queue: Q });
        throw new Error("regra de negócio falhou depois de enfileirar");
      }),
    );
    assert.deepEqual(await db.select().from(outbox), []);
  });
});

describe("relay", () => {
  it("decide o que já pode sair pelo relógio do banco: Node atrasado não segura mensagem recém-gravada", async (t) => {
    // A linha nasce com o `now()` do Postgres (microssegundos). Se o relay
    // comparasse com o `Date` do Node (milissegundos, às vezes de outra
    // máquina), a mensagem gravada no mesmo milissegundo ficava "no futuro" e
    // pulava a rodada. Aqui o Node fica uma hora atrás — o caso extremo do mesmo erro.
    await enqueue(db, { type: "teste.job", queue: Q });
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() - 60 * 60 * 1000 });
    try {
      assert.deepEqual(await relayOutbox(db), { published: 1, failed: 0 });
    } finally {
      t.mock.timers.reset();
    }
  });

  it("publica com confirmação, marca como publicada e preserva o id da mensagem", async () => {
    const { id } = await enqueue(db, { type: "teste.job", queue: Q, payload: { a: 1 }, maxAttempts: 3 });

    assert.deepEqual(await relayOutbox(db), { published: 1, failed: 0 });
    const row = await db.query.outbox.findFirst({ where: eq(outbox.id, id) });
    assert.ok(row?.publishedAt);
    assert.deepEqual(await depth(), { ready: 1, retrying: 0, dead: 0 });

    const { seen, handlers } = recorder();
    await drain(handlers);
    assert.equal(seen[0].id, id, "messageId = id da outbox: chave de idempotência");
    assert.deepEqual(seen[0].payload, { a: 1 });
    assert.equal(seen[0].attempt, 1);
    assert.equal(seen[0].maxAttempts, 3);
    assert.equal((await relayOutbox(db)).published, 0, "não publica de novo");
  });

  it("broker fora do ar: nada se perde — a outbox tenta de novo com backoff", async () => {
    await enqueue(db, { type: "teste.job", queue: Q });
    const realUrl = process.env.RABBITMQ_URL;
    await closeBroker();
    process.env.RABBITMQ_URL = "amqp://ninguem:nada@127.0.0.1:1"; // porta sem broker
    try {
      assert.deepEqual(await relayOutbox(db), { published: 0, failed: 1 });
    } finally {
      await closeBroker();
      if (realUrl === undefined) delete process.env.RABBITMQ_URL;
      else process.env.RABBITMQ_URL = realUrl;
    }

    const [row] = await db.select().from(outbox);
    assert.equal(row.publishedAt, null);
    assert.equal(row.publishAttempts, 1);
    assert.ok(row.lastError);
    assert.ok(row.nextAttemptAt.getTime() > Date.now(), "próxima tentativa com backoff, não em laço");
    assert.equal((await relayOutbox(db)).published, 0, "antes da hora, não tenta");

    // Broker de volta: na hora da próxima tentativa, publica.
    assert.equal((await relayOutbox(db, { now: row.nextAttemptAt })).published, 1);
    assert.deepEqual(await depth(), { ready: 1, retrying: 0, dead: 0 });
  });

  it("relays em paralelo não publicam a mesma mensagem duas vezes (SKIP LOCKED)", async () => {
    for (let i = 0; i < 20; i += 1) await enqueue(db, { type: "teste.job", queue: Q, payload: { i } });
    const reports = await Promise.all([relayOutbox(db, { limit: 7 }), relayOutbox(db, { limit: 7 }), relayOutbox(db, { limit: 7 })]);
    const total = reports.reduce((sum, report) => sum + report.published, 0);
    assert.equal(total + (await relayOutbox(db)).published, 20);
    assert.equal((await depth()).ready, 20);
  });

  it("entrega adiada sai pela fila de espera e só chega depois do atraso", async () => {
    await enqueue(db, { type: "teste.job", queue: Q, delayMs: 100 });
    await relayOutbox(db);
    assert.deepEqual(await depth(), { ready: 0, retrying: 1, dead: 0 });

    const { seen, handlers } = recorder();
    await drain(handlers, true);
    assert.equal(seen.length, 1);
  });
});

describe("política de retentativa", () => {
  it("sucesso: ack e a fila esvazia", async () => {
    await enqueue(db, { type: "teste.job", queue: Q });
    const { handlers } = recorder();
    assert.deepEqual(await drain(handlers), { received: 1, acked: 1, retried: 0, dead: 0 });
    assert.deepEqual(await depth(), { ready: 0, retrying: 0, dead: 0 });
  });

  it("erro transitório: volta pela fila de espera e a tentativa seguinte sabe que é a 2ª", async () => {
    await enqueue(db, { type: "teste.job", queue: Q, maxAttempts: 3 });
    const { seen, handlers } = recorder((message) => {
      if (message.attempt === 1) throw new RetryableError("gateway_unavailable", "fora do ar");
    });

    assert.deepEqual(await drain(handlers), { received: 1, acked: 0, retried: 1, dead: 0 });
    assert.deepEqual(await depth(), { ready: 0, retrying: 1, dead: 0 }, "esperando o TTL, não na fila de trabalho");

    await drain(handlers, true);
    assert.deepEqual(seen.map((message) => message.attempt), [1, 2]);
    assert.equal(seen[0].id, seen[1].id, "mesma mensagem, mesmo id");
    assert.deepEqual(await depth(), { ready: 0, retrying: 0, dead: 0 });
  });

  it("esgotadas as tentativas: DLQ, com o último erro e as tentativas no cabeçalho", async () => {
    await enqueue(db, { type: "teste.job", queue: Q, maxAttempts: 3 });
    const { seen, handlers } = recorder(() => {
      throw new Error("timeout do provedor"); // erro desconhecido = transitório
    });

    await drain(handlers, true);
    assert.equal(seen.length, 3);
    assert.deepEqual(await depth(), { ready: 0, retrying: 0, dead: 1 });

    const [letter] = await peekDeadLetters(Q);
    assert.equal(letter.type, "teste.job");
    assert.equal(letter.attempts, 3);
    assert.match(letter.error ?? "", /timeout do provedor/);
    assert.ok(letter.failedAt);
  });

  it("erro permanente: DLQ na hora, sem gastar retry com o que não vai mudar", async () => {
    await enqueue(db, { type: "teste.job", queue: Q, maxAttempts: 5 });
    const { seen, handlers } = recorder(() => {
      throw new PermanentError("invalid_command", "payload inválido");
    });

    assert.deepEqual(await drain(handlers, true), { received: 1, acked: 0, retried: 0, dead: 1 });
    assert.equal(seen.length, 1);
  });

  it("tipo sem handler vai para DLQ (não some, não fica em laço)", async () => {
    await enqueue(db, { type: "tipo.desconhecido", queue: Q });
    assert.deepEqual(await drain({}), { received: 1, acked: 0, retried: 0, dead: 1 });
    const [letter] = await peekDeadLetters(Q);
    assert.match(letter.error ?? "", /Nenhum handler/);
  });

  it("mensagem ilegível vai para DLQ como veio", async () => {
    const broker = await getBroker();
    await queueDepths([Q]); // declara a topologia
    const n = names(Q, broker.config);
    broker.publisher.publish(n.exchange, Q, Buffer.from("{não é json"), { messageId: "x", type: "teste.job" });
    await broker.publisher.waitForConfirms();

    const { seen, handlers } = recorder();
    assert.equal((await drain(handlers)).dead, 1);
    assert.equal(seen.length, 0);
    assert.equal((await depth()).dead, 1);
  });

  it("adiamento que não é falha (`countAttempt: false`) nunca empurra para DLQ", async () => {
    await enqueue(db, { type: "teste.job", queue: Q, maxAttempts: 2 });
    const { seen, handlers } = recorder(() => (seen.length < 4 ? { retryInMs: 50, countAttempt: false } : undefined));

    await drain(handlers, true);
    assert.equal(seen.length, 4, "adiada 3 vezes com maxAttempts = 2, e ainda assim processada");
    assert.ok(seen.every((message) => message.attempt === 1), "tentativa não andou");
    assert.equal((await depth()).dead, 0);
  });

  it("consumidor que morre sem ack: o broker reentrega (pelo menos uma vez)", async () => {
    await enqueue(db, { type: "teste.job", queue: Q });
    await relayOutbox(db);

    const broker = await getBroker();
    const channel = await broker.connection.createChannel();
    const raw = await channel.get(names(Q, broker.config).work, { noAck: false });
    assert.ok(raw, "pegou a mensagem");
    await channel.close(); // "morreu" no meio do processamento

    assert.equal((await depth()).ready, 1, "a mensagem voltou para a fila");
    const { seen, handlers } = recorder();
    await drain(handlers);
    assert.equal(seen.length, 1);
  });

  it("fila de espera escolhida arredonda o atraso para cima", () => {
    const tiers = [1_000, 5_000, 30_000];
    assert.equal(retryTierFor(1, tiers), 1_000);
    assert.equal(retryTierFor(1_000, tiers), 1_000);
    assert.equal(retryTierFor(1_001, tiers), 5_000);
    assert.equal(retryTierFor(10 * 60_000, tiers), 30_000, "acima do maior, usa o maior");
  });
});

describe("DLQ: inspeção e reprocessamento", () => {
  async function twoDeadLetters() {
    await enqueue(db, { type: "teste.job", queue: Q, payload: { n: 1 } });
    await enqueue(db, { type: "teste.job", queue: Q, payload: { n: 2 } });
    const { handlers } = recorder(() => {
      throw new PermanentError("quebrado", "ainda quebrado");
    });
    await drain(handlers);
    return peekDeadLetters(Q);
  }

  it("olhar a DLQ não consome nada", async () => {
    const letters = await twoDeadLetters();
    assert.equal(letters.length, 2);
    assert.equal((await peekDeadLetters(Q)).length, 2);
    assert.equal((await depth()).dead, 2);
  });

  it("reprocessa só a mensagem pedida, com as tentativas zeradas", async () => {
    const [first, second] = await twoDeadLetters();

    assert.equal(await replayDeadLetters(Q, { messageId: second.id }), 1);
    assert.deepEqual(await depth(), { ready: 1, retrying: 0, dead: 1 });
    assert.deepEqual((await peekDeadLetters(Q)).map((letter) => letter.id), [first.id]);

    const { seen, handlers } = recorder(); // causa corrigida
    await drain(handlers);
    assert.equal(seen[0].id, second.id);
    assert.equal(seen[0].attempt, 1);
  });

  it("reprocessa tudo de uma vez", async () => {
    await twoDeadLetters();
    assert.equal(await replayDeadLetters(Q), 2);
    assert.deepEqual(await depth(), { ready: 2, retrying: 0, dead: 0 });
  });

  it("o cabeçalho da DLQ guarda o erro de quem desistiu", async () => {
    await twoDeadLetters();
    const broker = await getBroker();
    const channel = await broker.connection.createChannel();
    const raw = await channel.get(names(Q, broker.config).dead, { noAck: false });
    assert.ok(raw);
    assert.match(String(raw.properties.headers?.[HEADER_ERROR]), /ainda quebrado/);
    assert.equal(raw.properties.headers?.[HEADER_ATTEMPTS], 1);
    await channel.close();
  });
});

describe("worker de longa duração (push)", () => {
  it("conexão com o broker cai no meio: o worker reconecta sozinho e volta a consumir", async () => {
    const { seen, handlers } = recorder();
    const worker = startWorker({ outboxes: [db], workerId: "teste-reconexao", queues: [Q], handlers, relayEveryMs: 50 });
    const until = async (cond: () => boolean) => {
      const deadline = Date.now() + 8_000;
      while (!cond() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    };

    await enqueue(db, { type: "teste.job", queue: Q, payload: { n: 1 } });
    await until(() => seen.length >= 1);

    // Derruba a conexão por baixo do worker (o que acontece num restart do broker).
    const broker = await getBroker();
    await broker.connection.close();

    await enqueue(db, { type: "teste.job", queue: Q, payload: { n: 2 } });
    await until(() => seen.length >= 2);
    worker.stop();
    await worker.done;

    assert.deepEqual(seen.map((message) => message.payload.n), [1, 2]);
    assert.deepEqual(await depth(), { ready: 0, retrying: 0, dead: 0 });
  });

  it("consome o que o relay publica e encerra limpo, sem largar mensagem pela metade", async () => {
    const { seen, handlers } = recorder(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    const worker = startWorker({ outboxes: [db], workerId: "teste", queues: [Q], handlers, relayEveryMs: 50 });

    await enqueue(db, { type: "teste.job", queue: Q, payload: { n: 1 } });
    await enqueue(db, { type: "teste.job", queue: Q, payload: { n: 2 } });

    const deadline = Date.now() + 5_000;
    while (seen.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    worker.stop();
    await worker.done;

    assert.equal(seen.length, 2);
    assert.deepEqual(await depth(), { ready: 0, retrying: 0, dead: 0 }, "as duas com ack antes de parar");
  });
});
