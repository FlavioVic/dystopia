/**
 * Caso de uso: registrar um pedido de orçamento já validado — o mesmo caminho
 * para o formulário de /servicos e para o assistente. Fica num lugar só para
 * que o assistente não vire uma porta lateral sem limite de tentativas nem alerta.
 */

import { db } from "@/db";
import { limitFromEnv } from "@/lib/rate-limit-config";
import { serviceName } from "@/lib/services-catalog";
import type { ServiceRequestValues } from "@/lib/validation/service-request";
import { sendServiceRequestAlert } from "@/services/notifications";
import { consumeRateLimit, type RateLimitRule } from "@/services/rate-limit";
import { createServiceRequest } from "@/services/service-requests";
import type { UseCaseHooks } from "./hooks";

// Entrada pública sem login: limite por IP para ninguém encher a caixa do
// admin com pedido falso em loop. A chave é a mesma para os dois canais.
const REQUEST_RULE: RateLimitRule = { limit: limitFromEnv("SERVICE_REQUEST_LIMIT_PER_HOUR", 5), windowSeconds: 60 * 60 };

export type SubmitServiceRequestResult =
  | { ok: true; protocol: string }
  | { ok: false; retryAfterSeconds: number };

export type SubmitServiceRequestInput = {
  values: ServiceRequestValues;
  ip: string;
  userId: string | null;
};

export async function submitServiceRequest(
  input: SubmitServiceRequestInput,
  hooks: UseCaseHooks = {},
): Promise<SubmitServiceRequestResult> {
  const { allowed, retryAfterSeconds } = await consumeRateLimit(db, `service-request:ip:${input.ip}`, REQUEST_RULE);
  if (!allowed) return { ok: false, retryAfterSeconds };

  const { values } = input;
  // Pedido e alerta na mesma transação (outbox): nunca um pedido sem aviso ao
  // responsável, nem aviso de pedido que não foi gravado. Sem SERVICE_ALERT_TO,
  // o pedido só aparece no /admin/orcamentos.
  const alertTo = process.env.SERVICE_ALERT_TO?.trim();
  const row = await db.transaction(async (tx) => {
    const created = await createServiceRequest(tx, { ...values, userId: input.userId });
    if (alertTo) {
      await sendServiceRequestAlert(tx, {
        recipient: alertTo,
        protocol: created.protocol,
        serviceName: serviceName(values.kind),
        name: created.name,
        email: created.email,
        phone: created.phone,
        details: created.details,
      });
    }
    return created;
  });
  if (alertTo) hooks.afterCommit?.();
  return { ok: true, protocol: row.protocol };
}
