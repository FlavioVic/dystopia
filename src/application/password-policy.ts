/**
 * Regra de senha nova (cadastro e redefinição) que o formulário sozinho não
 * confere: a senha não pode ter aparecido em vazamento (NIST SP 800-63B;
 * OWASP ASVS 5.0, 6.2.12). O formato — tamanho mínimo e os 72 bytes do
 * bcrypt — é da validação (`lib/validation/account.ts`).
 *
 * Quem chama filtra antes — limite por IP no cadastro, link válido na
 * redefinição: sem filtro, o site viraria um jeito de consultar o Pwned
 * Passwords em massa por nós.
 */

import { isBreachedPassword } from "@/services/accounts/pwned-passwords";

export const BREACHED_PASSWORD_MESSAGE =
  "Essa senha já apareceu em vazamentos de dados, e é das primeiras que um ataque testa. Escolha outra.";

/** Mensagem para o campo da senha, ou `null` se ela pode ser usada. */
export async function breachedPasswordMessage(
  password: string,
  check: (password: string) => Promise<boolean | null> = isBreachedPassword,
): Promise<string | null> {
  return (await check(password)) === true ? BREACHED_PASSWORD_MESSAGE : null;
}
