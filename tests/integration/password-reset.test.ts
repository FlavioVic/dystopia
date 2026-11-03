/**
 * "Esqueci minha senha": o link só sai para conta que existe, vale uma vez e
 * por 30 minutos, o banco guarda só o hash, e trocar a senha derruba os
 * logins abertos.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, beforeEach, describe, it } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { passwordResets, sessions } from "@/db/schema";
import {
  isPasswordResetLinkValid,
  limitPasswordResetRequests,
  PASSWORD_RESET_LIMITS,
  resetPassword,
  sendPasswordResetLink,
} from "@/application/password-reset";
import { DEMO_ACCOUNT_EMAIL } from "@/lib/site";
import { registerAccount, verifyCredentials } from "@/services/accounts";
import type { DirectEmail } from "@/services/notifications/direct";
import { createPasswordReset, pruneExpiredPasswordResets, PASSWORD_RESET_TTL_SECONDS } from "@/services/password-resets";
import { createSession } from "@/services/sessions";
import { closeDatabase, resetDatabase } from "../helpers/db";

beforeEach(resetDatabase);
after(closeDatabase);

const EMAIL = "ana@exemplo.dev";
const OLD_PASSWORD = "senha-antiga-1";
const SITE = "https://loja.dev";

async function register(email = EMAIL): Promise<string> {
  return (await registerAccount(db, { name: "Ana", email, password: OLD_PASSWORD })).id;
}

/** Caixa de saída falsa: guarda o que seria enviado. */
function outbox() {
  const sent: DirectEmail[] = [];
  return { sent, deps: { siteUrl: SITE, send: async (email: DirectEmail) => void sent.push(email) } };
}

function tokenFrom(email: DirectEmail): string {
  const match = email.text.match(/\/entrar\/redefinir\?token=([\w%-]+)/);
  assert.ok(match, "o e-mail leva o link");
  return decodeURIComponent(match[1]);
}

async function requestLink(email = EMAIL): Promise<string> {
  const box = outbox();
  assert.equal(await sendPasswordResetLink(email, box.deps), "sent");
  return tokenFrom(box.sent[0]);
}

describe("esqueci minha senha: o pedido", () => {
  it("conta existente recebe o link; o banco guarda só o hash do token", async () => {
    await register();
    const box = outbox();
    assert.equal(await sendPasswordResetLink(EMAIL, box.deps), "sent");

    assert.equal(box.sent.length, 1);
    const [email] = box.sent;
    assert.equal(email.to, EMAIL);
    assert.ok(email.text.startsWith("Ana."));
    const token = tokenFrom(email);
    assert.ok(email.text.includes(`${SITE}/entrar/redefinir?token=`));
    assert.ok(!email.idempotencyKey.includes(token), "a chave de idempotência vai para o provedor: não pode ser o token");

    const [row] = await db.select().from(passwordResets);
    assert.equal(row.id, createHash("sha256").update(token).digest("hex"));
    assert.ok(Math.abs(row.expiresAt.getTime() - Date.now() - PASSWORD_RESET_TTL_SECONDS * 1000) < 60_000);
  });

  it("e-mail sem conta: nada é enviado nem gravado", async () => {
    const box = outbox();
    assert.equal(await sendPasswordResetLink("ninguem@exemplo.dev", box.deps), "no-account");
    assert.equal(box.sent.length, 0);
    assert.equal((await db.select().from(passwordResets)).length, 0);
  });

  it("conta demo (senha publicada) não troca de senha por e-mail", async () => {
    await register(DEMO_ACCOUNT_EMAIL);
    const box = outbox();
    assert.equal(await sendPasswordResetLink(DEMO_ACCOUNT_EMAIL, box.deps), "demo");
    assert.equal(box.sent.length, 0);
  });

  it("limite por e-mail: depois de 3 na hora, para de mandar (ninguém lota a caixa de alguém)", async () => {
    await register();
    const box = outbox();
    const outcomes = [];
    for (let i = 0; i <= PASSWORD_RESET_LIMITS.email.limit; i++) outcomes.push(await sendPasswordResetLink(EMAIL, box.deps));

    assert.deepEqual(outcomes, ["sent", "sent", "sent", "limited"]);
    assert.equal(box.sent.length, 3);
  });

  it("limite por IP antes da resposta", async () => {
    const results = [];
    for (let i = 0; i <= PASSWORD_RESET_LIMITS.ip.limit; i++) results.push(await limitPasswordResetRequests("10.9.9.9"));

    assert.equal(results.filter((r) => r.allowed).length, PASSWORD_RESET_LIMITS.ip.limit);
    assert.equal(results.at(-1)?.allowed, false);
    assert.equal((await limitPasswordResetRequests("10.9.9.10")).allowed, true);
  });

  it("pedir de novo invalida o link anterior (só o e-mail mais recente vale)", async () => {
    await register();
    const first = await requestLink();
    const second = await requestLink();

    assert.equal(await isPasswordResetLinkValid(first), false);
    assert.equal(await isPasswordResetLinkValid(second), true);
  });
});

describe("esqueci minha senha: a troca", () => {
  it("a senha nova entra, a antiga não, os logins abertos caem e o link não vale de novo", async () => {
    const userId = await register();
    await createSession(db, { userId, mfaPending: false });
    await createSession(db, { userId, mfaPending: false });
    const token = await requestLink();

    assert.deepEqual(await resetPassword({ token, password: "senha-nova-123" }), { userId });

    assert.equal((await verifyCredentials(db, { email: EMAIL, password: "senha-nova-123" }))?.id, userId);
    assert.equal(await verifyCredentials(db, { email: EMAIL, password: OLD_PASSWORD }), null);
    assert.equal((await db.select().from(sessions).where(eq(sessions.userId, userId))).length, 0);
    assert.equal(await resetPassword({ token, password: "outra-senha-456" }), null, "uso único");
    assert.equal(await isPasswordResetLinkValid(token), false);
  });

  it("dois envios simultâneos do mesmo link: só um troca", async () => {
    await register();
    const token = await requestLink();
    const results = await Promise.all([
      resetPassword({ token, password: "primeira-senha" }),
      resetPassword({ token, password: "segunda-senha" }),
    ]);

    assert.equal(results.filter(Boolean).length, 1);
    const winner = results[0] ? "primeira-senha" : "segunda-senha";
    assert.ok(await verifyCredentials(db, { email: EMAIL, password: winner }));
  });

  it("link vencido (mais de 30 minutos) não vale e não troca nada", async () => {
    const userId = await register();
    const past = new Date(Date.now() - (PASSWORD_RESET_TTL_SECONDS + 60) * 1000);
    const { token } = await createPasswordReset(db, userId, past);

    assert.equal(await isPasswordResetLinkValid(token), false);
    assert.equal(await resetPassword({ token, password: "senha-nova-123" }), null);
    assert.ok(await verifyCredentials(db, { email: EMAIL, password: OLD_PASSWORD }));
    assert.equal(await pruneExpiredPasswordResets(db), 1, "a faxina apaga");
  });

  it("link inventado não vale", async () => {
    await register();
    await requestLink();

    assert.equal(await isPasswordResetLinkValid("inventado"), false);
    assert.equal(await resetPassword({ token: "inventado", password: "senha-nova-123" }), null);
  });

  it("excluir a conta leva o link junto", async () => {
    const userId = await register();
    await requestLink();
    await db.execute(sql`delete from users where id = ${userId}`);

    assert.equal((await db.select().from(passwordResets)).length, 0);
  });
});
