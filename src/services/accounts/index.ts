/**
 * Serviço de contas — cadastro e verificação de credenciais.
 *
 * Duas regras de segurança moram aqui (e não na borda) para valerem para quem
 * chamar:
 * - cadastro sem corrida: quem decide se o e-mail já existe é o índice único,
 *   no próprio INSERT — "consulta e depois insere" deixava dois cadastros
 *   simultâneos estourarem como erro 500;
 * - login não revela quais e-mails têm conta: com e-mail inexistente, compara
 *   contra um hash bcrypt real, então o tempo de resposta é o mesmo.
 */

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { Executor } from "@/db";
import { users } from "@/db/schema";
import { PermanentError } from "@/shared/errors";

const BCRYPT_COST = 10;

// Hash bcrypt válido (custo 10, de um segredo aleatório descartado). Precisa
// ser real: um hash inválido é recusado na hora, e a resposta mais rápida
// entregaria quais e-mails têm conta.
const DUMMY_HASH = "$2b$10$Y/CEvd/r/IxO4k29XllMJOjmYQnSj8TaybVNu9sGSAoHuQnkbS5A.";

export type Account = { id: string; role: "customer" | "admin" };

/** Cria a conta. E-mail já cadastrado → `PermanentError("email_taken")`. */
export async function registerAccount(
  executor: Executor,
  input: { name: string; email: string; password: string },
): Promise<Account> {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  const [created] = await executor
    .insert(users)
    .values({ name: input.name, email: input.email, passwordHash })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id, role: users.role });
  if (!created) throw new PermanentError("email_taken", "Já existe uma conta com esse e-mail.");
  return created;
}

/**
 * Conta do e-mail, ou `null`. Uso interno (limite de login, redefinição de
 * senha) — a resposta a quem pediu nunca pode depender disto.
 */
export async function findAccountByEmail(executor: Executor, email: string): Promise<{ id: string; name: string } | null> {
  const user = await executor.query.users.findFirst({ where: eq(users.email, email), columns: { id: true, name: true } });
  return user ?? null;
}

/** Troca a senha (redefinição por e-mail). Quem chama já conferiu o direito de trocar. */
export async function setPassword(executor: Executor, userId: string, password: string): Promise<void> {
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  await executor.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
}

/** Conta dona do e-mail e da senha, ou `null` — sem dizer qual dos dois errou. */
export async function verifyCredentials(
  executor: Executor,
  input: { email: string; password: string },
): Promise<Account | null> {
  const user = await executor.query.users.findFirst({
    where: eq(users.email, input.email),
    columns: { id: true, role: true, passwordHash: true },
  });
  const matches = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  return user && matches ? { id: user.id, role: user.role } : null;
}
