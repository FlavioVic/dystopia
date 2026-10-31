/**
 * MFA do admin contra o banco de verdade: cadastro que só vale com o primeiro
 * código certo, segredo cifrado, código que não entra duas vezes (nem em
 * dois logins simultâneos) e códigos de recuperação de uso único.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mfaCredentials, mfaRecoveryCodes, users } from "@/db/schema";
import { PermanentError } from "@/shared/errors";
import {
  RECOVERY_CODE_COUNT,
  beginEnrollment,
  confirmEnrollment,
  getMfaStatus,
  hasConfirmedMfa,
  regenerateRecoveryCodes,
  removeAuthenticator,
  verifySecondFactor,
} from "@/services/mfa";
import { base32Encode, hotp, totp, totpStep } from "@/services/mfa/totp";
import { closeDatabase, resetDatabase } from "../helpers/db";

beforeEach(resetDatabase);
after(closeDatabase);

async function createAdmin(email = "admin@exemplo.dev"): Promise<string> {
  const [user] = await db.insert(users).values({ name: "Admin", email, passwordHash: "x", role: "admin" }).returning({ id: users.id });
  return user.id;
}

/** Admin com autenticador já confirmado; devolve o segredo (o "celular") e os códigos. */
async function enrolledAdmin(now = new Date()) {
  const userId = await createAdmin();
  const secret = await beginEnrollment(db, userId);
  const codes = await confirmEnrollment(db, userId, totp(secret, now), now);
  assert.ok(codes);
  return { userId, secret, codes };
}

// Momentos em passos de 30 s distintos e bem separados.
const at = (step: number) => new Date(step * 30_000 + 5_000);
const BASE_STEP = totpStep(new Date());

describe("MFA (TOTP)", () => {
  it("o segredo vai cifrado para o banco", async () => {
    const userId = await createAdmin();
    const secret = await beginEnrollment(db, userId);
    const [row] = await db.select().from(mfaCredentials);
    assert.match(row.secret, /^v1\./);
    for (const plain of [base32Encode(secret), secret.toString("hex"), secret.toString("base64"), secret.toString("base64url")]) {
      assert.ok(!row.secret.includes(plain), "segredo em claro no banco");
    }
  });

  it("cadastro só vale depois do primeiro código certo", async () => {
    const userId = await createAdmin();
    const secret = await beginEnrollment(db, userId);
    const now = at(BASE_STEP);

    assert.equal(await hasConfirmedMfa(db, userId), false, "QR mostrado ainda não é MFA");
    const wrong = totp(secret, now) === "000000" ? "111111" : "000000";
    assert.equal(await confirmEnrollment(db, userId, wrong, now), null);
    assert.equal(await hasConfirmedMfa(db, userId), false);

    const codes = await confirmEnrollment(db, userId, totp(secret, now), now);
    assert.equal(codes?.length, RECOVERY_CODE_COUNT);
    assert.equal(new Set(codes).size, RECOVERY_CODE_COUNT);
    for (const code of codes!) assert.match(code, /^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
    assert.deepEqual(await getMfaStatus(db, userId), { enabled: true, confirmedAt: now, recoveryCodesLeft: RECOVERY_CODE_COUNT });
  });

  it("QR gerado de novo antes de confirmar troca o segredo: o celular com o QR velho não confirma", async () => {
    const userId = await createAdmin();
    const oldSecret = await beginEnrollment(db, userId);
    const newSecret = await beginEnrollment(db, userId);
    const now = at(BASE_STEP);
    if (totp(oldSecret, now) !== totp(newSecret, now)) {
      assert.equal(await confirmEnrollment(db, userId, totp(oldSecret, now), now), null);
    }
    assert.ok(await confirmEnrollment(db, userId, totp(newSecret, now), now));
  });

  it("depois de confirmado, não dá para recadastrar por cima (quem roubou a sessão não troca o autenticador)", async () => {
    const { userId } = await enrolledAdmin(at(BASE_STEP));
    await assert.rejects(beginEnrollment(db, userId), (error) => error instanceof PermanentError && error.code === "mfa_already_enabled");
  });

  it("confirmar sem ter gerado o QR é erro de regra", async () => {
    const userId = await createAdmin();
    await assert.rejects(confirmEnrollment(db, userId, "123456"), (error) => error instanceof PermanentError && error.code === "mfa_not_started");
  });

  it("login: código certo entra; o mesmo código de novo não (nem dentro dos 30 s)", async () => {
    const now = at(BASE_STEP);
    const { userId, secret } = await enrolledAdmin(now);
    const later = at(BASE_STEP + 4);

    assert.deepEqual(await verifySecondFactor(db, userId, totp(secret, later), later), { method: "totp" });
    assert.equal(await verifySecondFactor(db, userId, totp(secret, later), later), null, "replay");
    // Código de um passo ANTERIOR ao último usado (ainda dentro da tolerância) também não.
    assert.equal(await verifySecondFactor(db, userId, hotp(secret, BASE_STEP + 3), later), null);
    const next = at(BASE_STEP + 5);
    assert.deepEqual(await verifySecondFactor(db, userId, totp(secret, next), next), { method: "totp" });
  });

  it("o código usado para confirmar o cadastro também não vale para o login", async () => {
    const now = at(BASE_STEP);
    const { userId, secret } = await enrolledAdmin(now);
    assert.equal(await verifySecondFactor(db, userId, totp(secret, now), now), null);
  });

  it("dois logins simultâneos com o mesmo código: só um entra", async () => {
    const { userId, secret } = await enrolledAdmin(at(BASE_STEP));
    const later = at(BASE_STEP + 10);
    const code = totp(secret, later);
    const results = await Promise.all(Array.from({ length: 5 }, () => verifySecondFactor(db, userId, code, later)));
    assert.equal(results.filter(Boolean).length, 1);
  });

  it("código de recuperação vale uma vez, digitado de qualquer jeito", async () => {
    const { userId, codes } = await enrolledAdmin(at(BASE_STEP));
    const [first, second] = codes;

    assert.deepEqual(await verifySecondFactor(db, userId, first.toLowerCase().replaceAll("-", " ")), {
      method: "recovery",
      recoveryCodesLeft: RECOVERY_CODE_COUNT - 1,
    });
    assert.equal(await verifySecondFactor(db, userId, first), null, "já usado");
    assert.deepEqual(await verifySecondFactor(db, userId, second), { method: "recovery", recoveryCodesLeft: RECOVERY_CODE_COUNT - 2 });

    const rows = await db.select().from(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
    assert.ok(rows.every((row) => !codes.includes(row.codeHash)), "só hash no banco");
  });

  it("código de recuperação de outra conta não serve", async () => {
    const { codes } = await enrolledAdmin(at(BASE_STEP));
    const otherId = await createAdmin("outro@exemplo.dev");
    assert.equal(await verifySecondFactor(db, otherId, codes[0]), null);
  });

  it("códigos novos pedem o autenticador e matam os antigos", async () => {
    const { userId, secret, codes } = await enrolledAdmin(at(BASE_STEP));
    const later = at(BASE_STEP + 2);

    assert.equal(await regenerateRecoveryCodes(db, userId, codes[0], later), null, "código de recuperação não gera outros");
    const fresh = await regenerateRecoveryCodes(db, userId, totp(secret, later), later);
    assert.equal(fresh?.length, RECOVERY_CODE_COUNT);
    assert.equal(await verifySecondFactor(db, userId, codes[0]), null, "antigo parou de valer");
    assert.equal((await verifySecondFactor(db, userId, fresh![0]))?.method, "recovery");
  });

  it("trocar de celular pede um fator agora; depois o cadastro recomeça do zero", async () => {
    const { userId, secret, codes } = await enrolledAdmin(at(BASE_STEP));

    assert.equal(await removeAuthenticator(db, userId, "000000", at(BASE_STEP + 1)), false, "sem fator, nada muda");
    assert.equal(await hasConfirmedMfa(db, userId), true);

    // Celular perdido: entra com um código de recuperação.
    assert.equal(await removeAuthenticator(db, userId, codes[0]), true);
    assert.equal(await hasConfirmedMfa(db, userId), false, "painel fecha até o cadastro novo");
    assert.equal((await db.select().from(mfaRecoveryCodes)).length, 0, "códigos antigos somem");
    assert.equal(await verifySecondFactor(db, userId, totp(secret, at(BASE_STEP + 2)), at(BASE_STEP + 2)), null, "o celular velho não serve");

    const fresh = await beginEnrollment(db, userId);
    assert.ok(await confirmEnrollment(db, userId, totp(fresh, at(BASE_STEP + 3)), at(BASE_STEP + 3)));
  });

  it("sem MFA cadastrado, nada passa como segundo fator", async () => {
    const userId = await createAdmin();
    assert.equal(await verifySecondFactor(db, userId, "123456"), null);
    assert.equal(await verifySecondFactor(db, userId, "AAAA-BBBB-CCCC-DDDD"), null);
  });

  it("conta excluída leva o segredo e os códigos junto", async () => {
    const { userId } = await enrolledAdmin(at(BASE_STEP));
    await db.delete(users).where(eq(users.id, userId));
    assert.equal((await db.select().from(mfaCredentials)).length, 0);
    assert.equal((await db.select().from(mfaRecoveryCodes)).length, 0);
  });
});
