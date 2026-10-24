/**
 * Entrega das notificações — o job `notifications.deliver`.
 *
 * Roda fora da transação do passo (outbox): lê a notificação `pending`,
 * manda pelo provedor e marca o resultado. Sem `RESEND_API_KEY`, a entrega é
 * simulada (só marca como enviada) — é assim que dev e testes rodam.
 *
 * Falha transitória volta pra fila com backoff; esgotadas as tentativas, o
 * job vai pra dead-letter (alerta no admin) e a notificação fica `failed`.
 * Recusa definitiva do provedor (destinatário inválido…) marca `failed` na hora.
 */

import { eq } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { notifications } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import type { ClaimedJob } from "@/queue";
import { errorMessage, isRetryable } from "@/saga/errors";
import { NOTIFICATION_DELIVER_JOB } from "./index";
import { emailConfigFromEnv, RESEND_PROVIDER, resendSend, type EmailConfig, type FetchLike } from "./resend";

const logger = createLogger("notifications");
export const SIMULATED_PROVIDER = "simulado";

export type DeliveryDeps = { email: EmailConfig | null; fetch: FetchLike };
const defaultDeps = (): DeliveryDeps => ({ email: emailConfigFromEnv(), fetch });

/** Quem entrega neste processo; chamado na subida pra falhar cedo com config errada. */
export function emailProvider(): string {
  const config = emailConfigFromEnv();
  if (!config) return SIMULATED_PROVIDER;
  return config.redirectTo ? `${RESEND_PROVIDER} (sandbox → ${config.redirectTo})` : RESEND_PROVIDER;
}

export type DeliveryOutcome = "sent" | "failed" | "already-sent" | "not-found";

export async function deliverNotification(
  executor: Executor,
  notificationId: string,
  options: { finalAttempt?: boolean; deps?: DeliveryDeps } = {},
): Promise<DeliveryOutcome> {
  const deps = options.deps ?? defaultDeps();
  const row = await executor.query.notifications.findFirst({ where: eq(notifications.id, notificationId) });
  if (!row) return "not-found";
  if (row.status === "sent") return "already-sent";

  if (!deps.email) {
    await markSent(executor, row.id, { provider: SIMULATED_PROVIDER, deliveredTo: row.recipient, messageId: null });
    return "sent";
  }

  // Sandbox: tudo vai pro dono do projeto, e o assunto diz pra quem seria.
  const to = deps.email.redirectTo ?? row.recipient;
  const subject = deps.email.redirectTo ? `[demo → ${row.recipient}] ${row.subject}` : row.subject;

  try {
    const messageId = await resendSend(
      deps.email,
      { to, subject, text: row.body, html: renderHtml(row.subject, row.body), idempotencyKey: row.dedupeKey },
      deps.fetch,
    );
    await markSent(executor, row.id, { provider: RESEND_PROVIDER, deliveredTo: to, messageId });
    return "sent";
  } catch (error) {
    const message = errorMessage(error);
    const giveUp = !isRetryable(error) || options.finalAttempt === true;
    await executor
      .update(notifications)
      .set({ lastError: message, ...(giveUp ? { status: "failed" as const } : {}) })
      .where(eq(notifications.id, row.id));
    if (!isRetryable(error)) {
      logger.warn("e-mail recusado pelo provedor", { notificationId: row.id, error: message });
      return "failed";
    }
    throw error; // a fila tenta de novo (ou manda pra dead-letter na última)
  }
}

async function markSent(
  executor: Executor,
  id: string,
  sent: { provider: string; deliveredTo: string; messageId: string | null },
): Promise<void> {
  await executor
    .update(notifications)
    .set({
      status: "sent",
      provider: sent.provider,
      deliveredTo: sent.deliveredTo,
      providerMessageId: sent.messageId,
      lastError: null,
      sentAt: new Date(),
    })
    .where(eq(notifications.id, id));
}

/** Handlers que o worker registra; os testes passam `deps` pra não tocar a rede. */
export function createNotificationHandlers(deps?: DeliveryDeps) {
  return {
    [NOTIFICATION_DELIVER_JOB]: async (job: ClaimedJob) => {
      const id = job.payload.notificationId;
      if (typeof id !== "string") throw new Error("job de entrega sem notificationId");
      await deliverNotification(db, id, { finalAttempt: job.attempts >= job.maxAttempts, deps });
      return { settled: false };
    },
  };
}

// ---------------------------------------------------------------------------

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * HTML simples, com estilo inline (cliente de e-mail ignora <style>, CSS vars
 * e webfont). As cores repetem a paleta da marca em globals.css: obsidian,
 * graphite, steel, bone. O nome vai em texto espaçado — o wordmark desenhado
 * não sobrevive a cliente de e-mail que bloqueia imagem.
 */
export function renderHtml(subject: string, body: string): string {
  const lines = body
    .split("\n")
    .map((line) =>
      line.trim() === ""
        ? '<div style="height:12px"></div>'
        : `<p style="margin:0 0 6px;font-size:15px;line-height:1.5;color:#e7e3da">${escapeHtml(line)}</p>`,
    )
    .join("");
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#0b0b0c;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#1f2023;border:1px solid #6e7176">
<tr><td style="padding:20px 24px;border-bottom:1px solid #6e7176;color:#e7e3da;font-size:18px;letter-spacing:6px">DYSTOPIA</td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 16px;font-size:18px;letter-spacing:2px;text-transform:uppercase;color:#e7e3da">${escapeHtml(subject)}</h1>${lines}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #6e7176;font-family:'Courier New',monospace;font-size:11px;letter-spacing:1px;color:#8e9196">DYS-0001 / SETOR 04 — Projeto de portfólio de Flávio Victor. Nenhum valor foi cobrado.</td></tr>
</table></td></tr></table></body></html>`;
}
