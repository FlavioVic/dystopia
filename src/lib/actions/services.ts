"use server";

import { getCurrentUser } from "@/lib/data/auth";
import { drainQueueAfterResponse } from "@/lib/inline-worker";
import { getRequestIp } from "@/lib/request-ip";
import { submitServiceRequest } from "@/lib/service-request-submit";
import { parseServiceRequestForm } from "@/lib/validation/service-request";

export type ServiceRequestState =
  | {
      errors?: Record<string, string>;
      message?: string;
      /** O que a pessoa digitou, para o formulário voltar preenchido. */
      values?: Partial<Record<"kind" | "name" | "email" | "phone" | "details", string>>;
      protocol?: string;
    }
  | undefined;

/** Registra um pedido de orçamento e devolve o protocolo. */
export async function requestService(_prev: ServiceRequestState, formData: FormData): Promise<ServiceRequestState> {
  const typed = Object.fromEntries(
    (["kind", "name", "email", "phone", "details"] as const).map((key) => [key, String(formData.get(key) ?? "")]),
  );
  const parsed = parseServiceRequestForm(formData);
  if (!parsed.ok) return { errors: parsed.errors, values: typed };

  const user = await getCurrentUser();
  const result = await submitServiceRequest({ values: parsed.values, ip: await getRequestIp(), userId: user?.id ?? null });
  if (!result.ok) {
    const minutes = Math.ceil(result.retryAfterSeconds / 60);
    return { message: `Limite de solicitações atingido. Nova tentativa em ${minutes} min.`, values: typed };
  }
  // O aviso ao responsável foi para a outbox: sem worker de pé, sai daqui.
  drainQueueAfterResponse({ budgetMs: 15_000 });
  return { protocol: result.protocol };
}
