"use server";

import { db } from "@/db";
import { getCurrentUser } from "@/lib/data/auth";
import { limitFromEnv } from "@/lib/rate-limit-config";
import { getRequestIp } from "@/lib/request-ip";
import { serviceName } from "@/lib/services-catalog";
import { parseServiceRequestForm } from "@/lib/validation/service-request";
import { consumeRateLimit, type RateLimitRule } from "@/services/rate-limit";
import { sendServiceRequestAlert } from "@/services/notifications";
import { createServiceRequest } from "@/services/service-requests";

export type ServiceRequestState =
  | {
      errors?: Record<string, string>;
      message?: string;
      /** O que a pessoa digitou, pra o formulário voltar preenchido. */
      values?: Partial<Record<"kind" | "name" | "email" | "phone" | "details", string>>;
      protocol?: string;
    }
  | undefined;

// Formulário público sem login: limite por IP pra ninguém encher a caixa do
// admin com pedido falso em loop.
const REQUEST_RULE: RateLimitRule = { limit: limitFromEnv("SERVICE_REQUEST_LIMIT_PER_HOUR", 5), windowSeconds: 60 * 60 };

/** Registra um pedido de orçamento e devolve o protocolo. */
export async function requestService(_prev: ServiceRequestState, formData: FormData): Promise<ServiceRequestState> {
  const typed = Object.fromEntries(
    (["kind", "name", "email", "phone", "details"] as const).map((key) => [key, String(formData.get(key) ?? "")]),
  );
  const parsed = parseServiceRequestForm(formData);
  if (!parsed.ok) return { errors: parsed.errors, values: typed };
  const { values } = parsed;

  const { allowed, retryAfterSeconds } = await consumeRateLimit(
    db,
    `service-request:ip:${await getRequestIp()}`,
    REQUEST_RULE,
  );
  if (!allowed) {
    const minutes = Math.ceil(retryAfterSeconds / 60);
    return { message: `Limite de solicitações atingido. Nova tentativa em ${minutes} min.`, values: typed };
  }

  const user = await getCurrentUser();
  const kind = values.kind;
  // Pedido e alerta na mesma transação (outbox): nunca um pedido sem aviso ao
  // responsável, nem aviso de pedido que não foi gravado. Sem SERVICE_ALERT_TO,
  // o pedido só aparece no /admin/orcamentos.
  const alertTo = process.env.SERVICE_ALERT_TO?.trim();
  const row = await db.transaction(async (tx) => {
    const created = await createServiceRequest(tx, {
      kind,
      name: values.name,
      email: values.email,
      phone: values.phone,
      details: values.details,
      userId: user?.id ?? null,
    });
    if (alertTo) {
      await sendServiceRequestAlert(tx, {
        recipient: alertTo,
        protocol: created.protocol,
        serviceName: serviceName(kind),
        name: created.name,
        email: created.email,
        phone: created.phone,
        details: created.details,
      });
    }
    return created;
  });
  return { protocol: row.protocol };
}
