/**
 * Cifra do segredo do autenticador: quem copia o banco (sem a chave), quem
 * mexe no texto cifrado e quem troca o segredo de uma conta pelo de outra
 * não consegue nada.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import { openSecret, sealSecret } from "@/services/mfa/secret-box";

// Cada arquivo de teste roda em processo próprio: mexer no ambiente aqui não vaza.
const KEY = randomBytes(32).toString("base64");
process.env.MFA_ENCRYPTION_KEY = KEY;
afterEach(() => {
  process.env.MFA_ENCRYPTION_KEY = KEY;
});

const secret = Buffer.from("segredo-do-autenticador");

describe("cifra do segredo TOTP (AES-256-GCM)", () => {
  it("abre o que fechou, e o texto cifrado não contém o segredo", () => {
    const sealed = sealSecret(secret, "user-1");
    assert.match(sealed, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    assert.ok(!sealed.includes(secret.toString("base64url")));
    assert.deepEqual(openSecret(sealed, "user-1"), secret);
  });

  it("IV novo a cada vez: o mesmo segredo não vira o mesmo texto", () => {
    assert.notEqual(sealSecret(secret, "user-1"), sealSecret(secret, "user-1"));
  });

  it("segredo de uma conta colado na linha de outra não abre", () => {
    const sealed = sealSecret(secret, "user-1");
    assert.throws(() => openSecret(sealed, "user-2"));
  });

  it("texto cifrado adulterado não abre", () => {
    const [version, iv, tag, body] = sealSecret(secret, "user-1").split(".");
    const flipped = Buffer.from(body, "base64url");
    flipped[0] ^= 1;
    assert.throws(() => openSecret([version, iv, tag, flipped.toString("base64url")].join("."), "user-1"));
  });

  it("tag curta é recusada (senão se acerta no chute)", () => {
    const [version, iv, tag, body] = sealSecret(secret, "user-1").split(".");
    const short = Buffer.from(tag, "base64url").subarray(0, 4).toString("base64url");
    assert.throws(() => openSecret([version, iv, short, body].join("."), "user-1"));
  });

  it("outra chave não abre", () => {
    const sealed = sealSecret(secret, "user-1");
    process.env.MFA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    assert.throws(() => openSecret(sealed, "user-1"));
  });

  it("sem chave, ou chave do tamanho errado, falha dizendo o que fazer", () => {
    delete process.env.MFA_ENCRYPTION_KEY;
    assert.throws(() => sealSecret(secret, "user-1"), /MFA_ENCRYPTION_KEY não está definida/);
    process.env.MFA_ENCRYPTION_KEY = Buffer.from("curta").toString("base64");
    assert.throws(() => sealSecret(secret, "user-1"), /32 bytes/);
  });

  it("formato desconhecido é recusado", () => {
    assert.throws(() => openSecret("texto-qualquer", "user-1"), /formato desconhecido/);
  });
});
