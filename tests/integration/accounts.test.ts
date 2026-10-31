/**
 * Contas: cadastro sem corrida (o índice único decide) e login que não
 * revela quais e-mails existem.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { db } from "@/db";
import { users } from "@/db/schema";
import { PermanentError } from "@/shared/errors";
import { registerAccount, verifyCredentials } from "@/services/accounts";
import { closeDatabase, resetDatabase } from "../helpers/db";

beforeEach(resetDatabase);
after(closeDatabase);

const input = { name: "Ana", email: "ana@exemplo.dev", password: "senha-forte-1" };

describe("contas", () => {
  it("dois cadastros simultâneos com o mesmo e-mail: um entra, o outro recebe erro de regra", async () => {
    const results = await Promise.allSettled([registerAccount(db, input), registerAccount(db, input)]);

    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const [rejected] = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    assert.ok(rejected.reason instanceof PermanentError, "não é erro de banco cru (500)");
    assert.equal(rejected.reason.code, "email_taken");
    assert.equal((await db.select().from(users)).length, 1);
  });

  it("guarda hash, nunca a senha", async () => {
    await registerAccount(db, input);
    const [row] = await db.select().from(users);
    assert.notEqual(row.passwordHash, input.password);
    assert.match(row.passwordHash, /^\$2[aby]\$10\$/);
    assert.equal(row.role, "customer");
  });

  it("credenciais certas devolvem a conta; senha errada e e-mail inexistente devolvem o mesmo null", async () => {
    const account = await registerAccount(db, input);

    assert.deepEqual(await verifyCredentials(db, { email: input.email, password: input.password }), account);
    assert.equal(await verifyCredentials(db, { email: input.email, password: "errada" }), null);
    assert.equal(await verifyCredentials(db, { email: "ninguem@exemplo.dev", password: "qualquer" }), null);
  });
});
