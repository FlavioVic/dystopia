/**
 * Senha que já vazou não serve como senha nova (NIST SP 800-63B, 3.1.1.2;
 * OWASP ASVS 5.0, 6.2.12): quem ataca testa primeiro as listas de vazamento.
 *
 * Consulta o Pwned Passwords (Have I Been Pwned) por k-anonimato: a senha
 * nunca sai daqui, nem o hash inteiro — só os 5 primeiros caracteres do SHA-1.
 * A API devolve todos os sufixos que começam com eles (centenas), e a
 * comparação acontece aqui. `Add-Padding` mistura respostas falsas para o
 * tamanho da resposta também não entregar nada.
 *
 * Se a API não responder, a senha passa (e o log avisa): o cadastro não pode
 * depender de um serviço de fora estar de pé. É o que GitHub, 1Password e Okta
 * fazem.
 */

import { createHash } from "node:crypto";
import { createLogger } from "@/lib/logger";

const logger = createLogger("senha-vazada");

const API = "https://api.pwnedpasswords.com/range/";
const TIMEOUT_MS = 2_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** `true` vazou; `false` não consta; `null` não deu para saber (a senha passa). */
export async function isBreachedPassword(password: string, fetchImpl: FetchLike = fetch): Promise<boolean | null> {
  const hash = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  let body: string;
  try {
    const response = await fetchImpl(API + prefix, {
      headers: { "Add-Padding": "true", "User-Agent": "dystopia-loja" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    body = await response.text();
  } catch (error) {
    logger.warn("Pwned Passwords não respondeu; a senha passou sem a checagem", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  // Linhas "SUFIXO:QUANTIDADE". As do padding vêm com quantidade 0.
  for (const line of body.split("\n")) {
    const [candidate, count] = line.trim().split(":");
    if (candidate === suffix) return Number(count) > 0;
  }
  return false;
}
