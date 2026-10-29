/**
 * TOTP: os vetores do próprio RFC 6238 (Apêndice B) provam que o código bate
 * com o de qualquer app autenticador; o resto prova a janela de tolerância.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  matchTotp,
  otpauthUri,
  totp,
  totpStep,
} from "@/services/mfa/totp";

// Segredo do RFC (SHA-1): os 20 bytes ASCII de "12345678901234567890".
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");

describe("TOTP (RFC 6238)", () => {
  it("bate com os vetores de teste do RFC (8 dígitos, SHA-1)", () => {
    const vectors: Array<[number, string]> = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
      [20000000000, "65353130"],
    ];
    for (const [seconds, expected] of vectors) {
      assert.equal(totp(RFC_SECRET, new Date(seconds * 1000), 8), expected, `T=${seconds}`);
    }
  });

  it("6 dígitos são os 6 finais do código de 8 (mesmo truncamento)", () => {
    assert.equal(totp(RFC_SECRET, new Date(59_000)), "287082");
  });

  it("HOTP bate com o Apêndice D do RFC 4226", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expected.forEach((code, counter) => assert.equal(hotp(RFC_SECRET, counter), code, `contador ${counter}`));
  });

  it("aceita o passo anterior e o seguinte (relógio do celular fora de hora), não mais", () => {
    const secret = generateTotpSecret();
    const now = new Date("2026-10-29T12:00:15Z");
    const step = totpStep(now);
    assert.equal(matchTotp(secret, hotp(secret, step), now), step);
    assert.equal(matchTotp(secret, hotp(secret, step - 1), now), step - 1);
    assert.equal(matchTotp(secret, hotp(secret, step + 1), now), step + 1);
    assert.equal(matchTotp(secret, hotp(secret, step - 2), now), null);
    assert.equal(matchTotp(secret, hotp(secret, step + 2), now), null);
  });

  it("recusa o que não for exatamente 6 dígitos", () => {
    const secret = generateTotpSecret();
    const now = new Date();
    const code = totp(secret, now);
    for (const attempt of ["", "12345", `${code}0`, `${code.slice(0, 5)}a`, " 123456", "１２３４５６"]) {
      assert.equal(matchTotp(secret, attempt, now), null, JSON.stringify(attempt));
    }
  });

  it("segredo de outra conta não gera o mesmo código", () => {
    const now = new Date(59_000);
    const other = Buffer.from("outro-segredo-qualquer", "ascii");
    assert.equal(matchTotp(other, totp(RFC_SECRET, now), now), null);
  });

  it("base32 ida e volta (é o que a pessoa digita no app)", () => {
    for (let size = 0; size <= 21; size += 1) {
      const bytes = Buffer.from(Array.from({ length: size }, (_, i) => (i * 37 + size) & 255));
      assert.deepEqual(base32Decode(base32Encode(bytes)), bytes, `tamanho ${size}`);
    }
    // Vetores do RFC 4648.
    assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
    assert.deepEqual(base32Decode("mzxw 6ytb-oi"), Buffer.from("foobar"));
    assert.throws(() => base32Decode("MZXW1"), /base32 inválido/);
  });

  it("o QR leva issuer, conta e segredo no formato otpauth://", () => {
    const uri = new URL(otpauthUri({ secret: Buffer.from("foobar"), account: "admin@dystopia.dev", issuer: "DYSTOPIA" }));
    assert.equal(uri.protocol, "otpauth:");
    assert.equal(uri.host, "totp");
    assert.equal(decodeURIComponent(uri.pathname), "/DYSTOPIA:admin@dystopia.dev");
    assert.equal(uri.searchParams.get("secret"), "MZXW6YTBOI");
    assert.equal(uri.searchParams.get("issuer"), "DYSTOPIA");
    assert.equal(uri.searchParams.get("digits"), "6");
    assert.equal(uri.searchParams.get("period"), "30");
  });
});
