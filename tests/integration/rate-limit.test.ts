/**
 * Limite de tentativas: contagem por janela, chaves independentes, janela
 * vencida e — o motivo de morar no banco — concorrência sem perder contagem.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";
import { consumeRateLimit, pruneRateLimits } from "@/services/rate-limit";
import { closeDatabase, resetDatabase } from "../helpers/db";

const RULE = { limit: 3, windowSeconds: 60 };

/** Empurra a janela da chave para o passado, como se o tempo tivesse corrido. */
async function ageWindow(key: string, seconds: number): Promise<void> {
  await db
    .update(rateLimits)
    .set({ windowStartedAt: sql`now() - make_interval(secs => ${seconds})` })
    .where(eq(rateLimits.key, key));
}

describe("limite de tentativas", () => {
  beforeEach(resetDatabase);
  after(closeDatabase);

  it("deixa passar até o limite e barra a partir daí, dizendo quanto falta", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consumeRateLimit(db, "login:ip:1.1.1.1", RULE));

    assert.deepEqual(results.slice(0, 3).map((r) => r.allowed), [true, true, true]);
    assert.equal(results[3].allowed, false);
    assert.ok(results[3].retryAfterSeconds > 0 && results[3].retryAfterSeconds <= 60);
  });

  it("cada chave tem o próprio contador", async () => {
    for (let i = 0; i < 3; i++) await consumeRateLimit(db, "login:ip:1.1.1.1", RULE);

    assert.equal((await consumeRateLimit(db, "login:ip:1.1.1.1", RULE)).allowed, false);
    assert.equal((await consumeRateLimit(db, "login:ip:2.2.2.2", RULE)).allowed, true);
    assert.equal((await consumeRateLimit(db, "signup:ip:1.1.1.1", RULE)).allowed, true);
  });

  it("janela vencida recomeça a contagem do zero", async () => {
    for (let i = 0; i < 4; i++) await consumeRateLimit(db, "login:ip:1.1.1.1", RULE);
    await ageWindow("login:ip:1.1.1.1", 61);

    assert.deepEqual(await consumeRateLimit(db, "login:ip:1.1.1.1", RULE), {
      allowed: true,
      retryAfterSeconds: 0,
    });
    const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, "login:ip:1.1.1.1"));
    assert.equal(row.hits, 1);
  });

  it("tentativas simultâneas não se perdem (exatamente `limit` passam)", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => consumeRateLimit(db, "login:ip:9.9.9.9", RULE)),
    );

    assert.equal(results.filter((r) => r.allowed).length, RULE.limit);
    const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, "login:ip:9.9.9.9"));
    assert.equal(row.hits, 10);
  });

  it("a faxina apaga só janelas velhas", async () => {
    await consumeRateLimit(db, "velha", RULE);
    await consumeRateLimit(db, "nova", RULE);
    await ageWindow("velha", 7_200);

    assert.equal(await pruneRateLimits(db, 3_600), 1);
    const keys = (await db.select().from(rateLimits)).map((r) => r.key);
    assert.deepEqual(keys, ["nova"]);
  });
});
