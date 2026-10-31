/**
 * Caso de uso: ligar o autenticador (MFA) da conta.
 *
 * Cruza dois donos — o autenticador (`services/mfa`) e as sessões
 * (`services/sessions`) — numa transação só: o primeiro código certo liga o
 * MFA e derruba as outras sessões da conta, que foram abertas só com senha.
 * Ou as duas coisas acontecem, ou nenhuma.
 */

import { db } from "@/db";
import { confirmEnrollment } from "@/services/mfa";
import { revokeOtherSessions } from "@/services/sessions";

/** Códigos de recuperação quando o código confere; `null` quando não. */
export async function confirmMfaEnrollment(input: {
  userId: string;
  /** Sessão de quem está ligando: é a única que continua aberta. */
  currentSessionToken: string;
  code: string;
}): Promise<string[] | null> {
  return db.transaction(async (tx) => {
    const codes = await confirmEnrollment(tx, input.userId, input.code);
    if (codes) await revokeOtherSessions(tx, input.userId, input.currentSessionToken);
    return codes;
  });
}
