/**
 * Login e o limite por conta: o ataque distribuído (um IP por tentativa)
 * esbarra no limite da conta, mas não tranca o dono no aparelho onde ele já
 * entrou — e a resposta não revela quais e-mails existem.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { knownDevices, rateLimits } from "@/db/schema";
import { attemptLogin, LOGIN_LIMITS } from "@/application/login";
import { DEMO_ACCOUNT_EMAIL } from "@/lib/site";
import { registerAccount } from "@/services/accounts";
import { findKnownDevice, KNOWN_DEVICE_TTL_SECONDS, pruneStaleDevices, rememberDevice } from "@/services/known-devices";
import { closeDatabase, resetDatabase } from "../helpers/db";

beforeEach(resetDatabase);
after(closeDatabase);

const EMAIL = "ana@exemplo.dev";
const PASSWORD = "senha-certa-da-ana";
const ACCOUNT_LIMIT = LOGIN_LIMITS.account.limit;

let ipCounter = 0;
/** Um IP novo por tentativa: o ataque distribuído, que o limite por IP não pega. */
function freshIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

function attack(email: string, times: number, deviceToken?: string) {
  return Promise.all(
    Array.from({ length: times }, () => attemptLogin({ email, password: "chute-errado", ip: freshIp(), deviceToken })),
  );
}

async function register(email = EMAIL): Promise<string> {
  const account = await registerAccount(db, { name: "Ana", email, password: PASSWORD });
  return account.id;
}

describe("login: limite por conta", () => {
  it("falhas de IPs diferentes trancam o e-mail num aparelho desconhecido — até para a senha certa", async () => {
    await register();
    const results = await attack(EMAIL, ACCOUNT_LIMIT);
    assert.ok(results.every((r) => r.status === "invalid"));

    const owner = await attemptLogin({ email: EMAIL, password: PASSWORD, ip: freshIp() });
    assert.equal(owner.status, "limited");
    assert.ok(owner.status === "limited" && owner.scope === "account" && owner.retryAfterSeconds > 0);
  });

  it("no aparelho onde o dono já entrou, o ataque não tranca", async () => {
    const userId = await register();
    const { token } = await rememberDevice(db, { userId });
    await attack(EMAIL, ACCOUNT_LIMIT + 5);

    const owner = await attemptLogin({ email: EMAIL, password: PASSWORD, ip: freshIp(), deviceToken: token });
    assert.equal(owner.status, "ok");
  });

  it("cookie de aparelho de OUTRA conta não livra do contador desta", async () => {
    await register();
    const otherId = await register("bia@exemplo.dev");
    const { token } = await rememberDevice(db, { userId: otherId });
    await attack(EMAIL, ACCOUNT_LIMIT);

    const result = await attemptLogin({ email: EMAIL, password: PASSWORD, ip: freshIp(), deviceToken: token });
    assert.equal(result.status, "limited");
  });

  it("o aparelho conhecido tem limite próprio (o dono errando a própria senha)", async () => {
    const userId = await register();
    const { token } = await rememberDevice(db, { userId });
    const results = await attack(EMAIL, LOGIN_LIMITS.device.limit + 1, token);

    assert.equal(results.filter((r) => r.status === "invalid").length, LOGIN_LIMITS.device.limit);
    assert.equal(results.filter((r) => r.status === "limited").length, 1);
    // O contador do aparelho não é o da conta: aparelho desconhecido segue tentando.
    assert.equal((await attemptLogin({ email: EMAIL, password: PASSWORD, ip: freshIp() })).status, "ok");
  });

  it("login certo não conta como falha: devolve a vaga que reservou", async () => {
    await register();
    await attack(EMAIL, ACCOUNT_LIMIT - 1);
    assert.equal((await attemptLogin({ email: EMAIL, password: PASSWORD, ip: freshIp() })).status, "ok");

    // Ainda cabe uma falha (a 10ª); só a 11ª é barrada.
    const [last, blocked] = await attack(EMAIL, 2);
    assert.deepEqual([last.status, blocked.status].sort(), ["invalid", "limited"]);
  });

  it("tentativas simultâneas: no máximo `limit` chegam a conferir a senha", async () => {
    await register();
    const results = await attack(EMAIL, ACCOUNT_LIMIT * 3);

    assert.equal(results.filter((r) => r.status === "invalid").length, ACCOUNT_LIMIT);
  });

  it("e-mail sem conta é barrado igual: a resposta não revela quais e-mails existem", async () => {
    await attack("ninguem@exemplo.dev", ACCOUNT_LIMIT);

    const result = await attemptLogin({ email: "ninguem@exemplo.dev", password: "x", ip: freshIp() });
    assert.equal(result.status, "limited");
    assert.ok(result.status === "limited" && result.scope === "account");
  });

  it("a chave do contador guarda o hash do e-mail, nunca o e-mail", async () => {
    await attack(EMAIL, 1);
    const keys = (await db.select({ key: rateLimits.key }).from(rateLimits)).map((r) => r.key);

    assert.ok(keys.some((k) => k.startsWith("login:account:")));
    assert.ok(keys.every((k) => !k.includes(EMAIL)));
  });

  it("limite diário: depois de 50 falhas, a janela de 15 minutos vencer não reabre", async () => {
    await register();
    const rounds = LOGIN_LIMITS.accountDaily.limit / ACCOUNT_LIMIT;
    for (let round = 0; round < rounds; round++) {
      const results = await attack(EMAIL, ACCOUNT_LIMIT);
      assert.ok(results.every((r) => r.status === "invalid"), `rodada ${round}`);
      // O tempo corre 16 minutos: a janela curta vence, a diária não.
      await db
        .update(rateLimits)
        .set({ windowStartedAt: sql`${rateLimits.windowStartedAt} - interval '16 minutes'` })
        .where(like(rateLimits.key, "login:account:%"));
    }

    const result = await attemptLogin({ email: EMAIL, password: PASSWORD, ip: freshIp() });
    assert.equal(result.status, "limited");
    assert.ok(result.status === "limited" && result.retryAfterSeconds > 60 * 60);
  });

  it("conta demo (senha publicada) não tem limite por conta — só o de IP", async () => {
    await register(DEMO_ACCOUNT_EMAIL);
    const results = await attack(DEMO_ACCOUNT_EMAIL, ACCOUNT_LIMIT * 2);
    assert.ok(results.every((r) => r.status === "invalid"));

    assert.equal((await attemptLogin({ email: DEMO_ACCOUNT_EMAIL, password: PASSWORD, ip: freshIp() })).status, "ok");
  });

  it("o limite por IP continua valendo, antes do da conta", async () => {
    await register();
    const ip = freshIp();
    for (let i = 0; i < LOGIN_LIMITS.ip.limit; i++) {
      await attemptLogin({ email: `outra-${i}@exemplo.dev`, password: "x", ip });
    }

    const result = await attemptLogin({ email: EMAIL, password: PASSWORD, ip });
    assert.ok(result.status === "limited" && result.scope === "ip");
  });
});

describe("aparelhos conhecidos", () => {
  it("mesmo navegador, mesma conta: renova o uso e mantém o token", async () => {
    const userId = await register();
    const first = await rememberDevice(db, { userId });
    const again = await rememberDevice(db, { userId, currentToken: first.token });

    assert.equal(again.token, first.token);
    assert.equal((await db.select().from(knownDevices)).length, 1);
  });

  it("navegador com cookie de outra conta ganha um aparelho novo para esta", async () => {
    const anaId = await register();
    const biaId = await register("bia@exemplo.dev");
    const ana = await rememberDevice(db, { userId: anaId });
    const bia = await rememberDevice(db, { userId: biaId, currentToken: ana.token });

    assert.notEqual(bia.token, ana.token);
    assert.equal((await findKnownDevice(db, bia.token))?.userId, biaId);
    assert.equal((await findKnownDevice(db, ana.token))?.userId, anaId, "o da Ana não muda de dono");
  });

  it("o banco guarda o hash do token, não o token", async () => {
    const userId = await register();
    const { token } = await rememberDevice(db, { userId });
    const [row] = await db.select().from(knownDevices);

    assert.notEqual(row.id, token);
    assert.match(row.id, /^[0-9a-f]{64}$/);
  });

  it("sem uso por 180 dias volta a ser desconhecido, e a faxina apaga", async () => {
    const userId = await register();
    const { token } = await rememberDevice(db, { userId });
    const later = new Date(Date.now() + (KNOWN_DEVICE_TTL_SECONDS + 60) * 1000);

    assert.equal(await findKnownDevice(db, token, later), null);
    assert.equal(await pruneStaleDevices(db), 0, "hoje ainda vale");
    assert.equal(await pruneStaleDevices(db, later), 1);
  });

  it("excluir a conta leva os aparelhos junto", async () => {
    const userId = await register();
    await rememberDevice(db, { userId });
    await db.execute(sql`delete from users where id = ${userId}`);

    assert.equal((await db.select().from(knownDevices).where(eq(knownDevices.userId, userId))).length, 0);
  });
});
