/**
 * E-mail que não pode ficar gravado — hoje, o link de redefinição de senha.
 *
 * Os outros e-mails passam pela outbox: a notificação (com o corpo) é gravada
 * na transação e entregue depois, com retry. Aqui isso seria um vazamento: o
 * corpo leva um link que troca a senha da conta, e quem lesse a tabela
 * `notifications` (ou o painel) tomaria a conta. Então este sai direto pelo
 * provedor, sem gravar nada. O preço é não ter retry: se o Resend falhar, a
 * pessoa pede outro link.
 */

import { createLogger } from "@/lib/logger";
import { addressFor, emailConfigFromEnv, resendSend, type EmailConfig, type FetchLike } from "./resend";

const logger = createLogger("notifications");

export type DirectEmail = { to: string; subject: string; text: string; html: string; idempotencyKey: string };
export type DirectEmailDeps = { email: EmailConfig | null; fetch: FetchLike };

/**
 * Envia agora. Sem `RESEND_API_KEY` a entrega é simulada; em desenvolvimento
 * o texto vai para o log (é como se testa o link localmente). Em produção,
 * nunca: o log também não pode guardar o link.
 */
export async function sendEmailNow(
  email: DirectEmail,
  deps: DirectEmailDeps = { email: emailConfigFromEnv(), fetch },
): Promise<"sent" | "simulated"> {
  if (!deps.email) {
    if (process.env.NODE_ENV !== "production") {
      logger.info("e-mail simulado (sem RESEND_API_KEY)", { to: email.to, subject: email.subject, text: email.text });
    }
    return "simulated";
  }
  const { to, subject } = addressFor(deps.email, email.to, email.subject);
  await resendSend(deps.email, { ...email, to, subject }, deps.fetch);
  return "sent";
}
