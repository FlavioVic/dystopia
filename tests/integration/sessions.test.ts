/**
 * Sessão no banco: o que o JWT não fazia. Sair mata o token copiado, sessão
 * vencida não entra, metade do login (falta o código do autenticador) não é
 * login, e o banco não guarda nada que sirva de cookie.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { currentUserFrom, lookupSession } from "@/lib/data/auth";
import {
  PENDING_MFA_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  completeMfa,
  countActiveSessions,
  createSession,
  hashSessionToken,
  pruneExpiredSessions,
  revokeOtherSessions,
  revokeSession,
} from "@/services/sessions";
import { closeDatabase, resetDatabase } from "../helpers/db";

beforeEach(resetDatabase);
after(closeDatabase);

async function createUser(email = "ana@exemplo.dev", role: "customer" | "admin" = "customer"): Promise<string> {
  const [user] = await db.insert(users).values({ name: "Ana", email, passwordHash: "x", role }).returning({ id: users.id });
  return user.id;
}

const currentUser = async (token: string) => currentUserFrom(await lookupSession(db, token));

describe("sessões", () => {
  it("o banco guarda só o hash do token: copiar a tabela não dá cookie nenhum", async () => {
    const userId = await createUser();
    const { token } = await createSession(db, { userId, mfaPending: false });

    const [row] = await db.select().from(sessions);
    assert.notEqual(row.id, token);
    assert.equal(row.id, hashSessionToken(token));
    assert.ok(token.length >= 43, "32 bytes aleatórios em base64url");
    assert.equal(await currentUser(row.id), null, "o hash usado como cookie não abre sessão");
    assert.equal((await currentUser(token))?.id, userId);
  });

  it("sair revoga: o mesmo token, guardado em outro lugar, deixa de valer", async () => {
    const userId = await createUser();
    const { token } = await createSession(db, { userId, mfaPending: false });
    const copied = token;

    await revokeSession(db, token);
    assert.equal(await currentUser(copied), null);
  });

  it("validade de 7 dias, sem renovação; vencida não entra", async () => {
    const userId = await createUser();
    const now = new Date();
    const { token, expiresAt } = await createSession(db, { userId, mfaPending: false }, now);
    assert.equal(expiresAt.getTime() - now.getTime(), SESSION_TTL_SECONDS * 1000);

    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.id, hashSessionToken(token)));
    assert.equal(await currentUser(token), null);
  });

  it("senha certa e código pendente não é login; o código completa e dá a validade cheia", async () => {
    const userId = await createUser("admin@exemplo.dev", "admin");
    const now = new Date();
    const { token, expiresAt } = await createSession(db, { userId, mfaPending: true }, now);
    assert.equal(expiresAt.getTime() - now.getTime(), PENDING_MFA_TTL_SECONDS * 1000, "pendente dura minutos");

    const pending = await lookupSession(db, token);
    assert.equal(pending?.mfaPending, true);
    assert.equal(currentUserFrom(pending), null);

    const completed = await completeMfa(db, token, now);
    assert.equal(completed?.expiresAt.getTime(), now.getTime() + SESSION_TTL_SECONDS * 1000);
    assert.equal((await currentUser(token))?.id, userId);
    assert.equal(await completeMfa(db, token, now), null, "sessão já completa não completa de novo");
  });

  it("\"sair dos outros aparelhos\" mantém só a sessão atual", async () => {
    const userId = await createUser();
    const otherUser = await createUser("bia@exemplo.dev");
    const here = await createSession(db, { userId, mfaPending: false });
    const phone = await createSession(db, { userId, mfaPending: false });
    const laptop = await createSession(db, { userId, mfaPending: false });
    const someoneElse = await createSession(db, { userId: otherUser, mfaPending: false });

    assert.equal(await countActiveSessions(db, userId), 3);
    assert.equal(await revokeOtherSessions(db, userId, here.token), 2);
    assert.equal((await currentUser(here.token))?.id, userId);
    assert.equal(await currentUser(phone.token), null);
    assert.equal(await currentUser(laptop.token), null);
    assert.equal((await currentUser(someoneElse.token))?.id, otherUser, "sessão de outra pessoa não é tocada");
  });

  it("contagem não inclui sessão vencida nem login pela metade", async () => {
    const userId = await createUser();
    await createSession(db, { userId, mfaPending: false });
    await createSession(db, { userId, mfaPending: true });
    const expired = await createSession(db, { userId, mfaPending: false });
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.id, hashSessionToken(expired.token)));
    assert.equal(await countActiveSessions(db, userId), 1);
  });

  it("vencidas somem: na faxina e no próximo login da pessoa", async () => {
    const userId = await createUser();
    const old = await createSession(db, { userId, mfaPending: false });
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.id, hashSessionToken(old.token)));

    await createSession(db, { userId, mfaPending: false });
    assert.equal((await db.select().from(sessions)).length, 1, "o login novo levou a vencida");

    const other = await createUser("bia@exemplo.dev");
    const stale = await createSession(db, { userId: other, mfaPending: false });
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.id, hashSessionToken(stale.token)));
    assert.equal(await pruneExpiredSessions(db), 1);
    assert.equal((await db.select().from(sessions)).length, 1);
  });

  it("conta excluída leva as sessões junto", async () => {
    const userId = await createUser();
    const { token } = await createSession(db, { userId, mfaPending: false });
    await db.delete(users).where(eq(users.id, userId));
    assert.equal(await currentUser(token), null);
    assert.equal((await db.select().from(sessions)).length, 0);
  });

  it("token inventado ou vazio não acha ninguém", async () => {
    await createUser();
    assert.equal(await currentUser("token-inventado"), null);
    assert.equal(await currentUser(""), null);
  });
});
