/**
 * Cifra do segredo TOTP no banco (AES-256-GCM). Quem copia a tabela sem a
 * chave não gera código nenhum; quem adultera o texto cifrado é pego pela tag
 * do GCM.
 *
 * O contexto (id do usuário) entra como dado autenticado: trocar o segredo de
 * uma linha pelo de outra (para entrar com o autenticador de outra pessoa)
 * falha na hora de abrir.
 *
 * Formato: `v1.<iv>.<tag>.<cifrado>` (base64url). O `v1` deixa trocar de
 * algoritmo ou de chave depois sem adivinhar o que é cada linha.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

/** Lida na hora do uso (não ao carregar): o build e o worker não precisam dela. */
function encryptionKey(): Buffer {
  const raw = process.env.MFA_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("MFA_ENCRYPTION_KEY não está definida (gere com `openssl rand -base64 32`). Veja .env.example.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("MFA_ENCRYPTION_KEY precisa ter 32 bytes em base64 (`openssl rand -base64 32`).");
  return key;
}

export function sealSecret(plain: Buffer, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), body]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

/** Lança se a chave for outra, o texto tiver sido mexido ou o contexto não bater. */
export function openSecret(sealed: string, context: string): Buffer {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !body) throw new Error("segredo cifrado em formato desconhecido");
  // authTagLength fixo: sem ele o Node aceita tag curta, e tag de 4 bytes se acerta no chute.
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]);
}
