/**
 * TOTP (RFC 6238) — o código de 6 dígitos do Google Authenticator, Authy etc.
 *
 * A criptografia (HMAC-SHA1) é a do `node:crypto`; daqui é só a regra de
 * contagem do RFC: passo de 30 s, truncamento dinâmico (RFC 4226 §5.3) e
 * tolerância de um passo para cada lado (relógio do celular fora de hora).
 * Os vetores de teste do próprio RFC estão em `tests/unit/totp.test.ts`.
 *
 * Puro (sem banco): o teste de navegador usa este mesmo módulo para gerar o
 * código que um celular geraria.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_PERIOD_SECONDS = 30;
const DIGITS = 6;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** 160 bits, o tamanho que o RFC 4226 recomenda (e o da saída do SHA-1). */
export function generateTotpSecret(): Buffer {
  return randomBytes(20);
}

/** Base32 (RFC 4648, sem `=`): o formato que o app autenticador aceita digitado. */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error(`base32 inválido: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function totpStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

/** HOTP (RFC 4226): HMAC do contador, truncado em `digits` dígitos. */
export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totp(secret: Buffer, now = new Date(), digits = DIGITS): string {
  return hotp(secret, totpStep(now), digits);
}

/**
 * Passo de 30 s em que o código bate (o anterior, o atual ou o seguinte), ou
 * `null`. Quem chama guarda o passo: o mesmo código não pode valer duas vezes.
 */
export function matchTotp(secret: Buffer, code: string, now = new Date()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(now);
  let matched: number | null = null;
  // Compara os três sempre, em tempo constante: a resposta não diz qual passo quase bateu.
  for (const step of [current - 1, current, current + 1]) {
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(code)) && matched === null) matched = step;
  }
  return matched;
}

/** O conteúdo do QR code (formato `otpauth://` que os apps autenticadores leem). */
export function otpauthUri(input: { secret: Buffer; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: base32Encode(input.secret),
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params}`;
}
