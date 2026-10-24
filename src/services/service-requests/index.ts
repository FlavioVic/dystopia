/**
 * Serviço de pedidos de orçamento — responsabilidade única: registrar quem
 * pediu qual serviço e acompanhar o andamento (novo → em contato → fechado).
 *
 * Recebe valores já validados (lib/validation/service-request). Não passa
 * pela saga: não há estoque, cobrança nem compensação — é o começo de uma
 * conversa, não uma transação.
 */

import { randomInt } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { Executor } from "@/db";
import { serviceRequests } from "@/db/schema";
import { PermanentError } from "@/saga/errors";

export type ServiceRequestKind = (typeof serviceRequests.$inferInsert)["kind"];
export type ServiceRequestStatus = NonNullable<(typeof serviceRequests.$inferInsert)["status"]>;
export type ServiceRequestRow = typeof serviceRequests.$inferSelect;

export const SERVICE_REQUEST_STATUSES: ServiceRequestStatus[] = ["novo", "em_contato", "fechado", "arquivado"];

export type NewServiceRequest = {
  kind: ServiceRequestKind;
  name: string;
  email: string;
  phone: string | null;
  details: string;
  userId?: string | null;
};

/**
 * Protocolo curto e legível pra pessoa citar na conversa. Aleatório (não
 * sequencial) pra não expor quantos pedidos existem; o índice único pega a
 * colisão rara e a gente sorteia de novo.
 */
export function generateProtocol(random: (max: number) => number = randomInt): string {
  return `DYS-S${String(random(1_000_000)).padStart(6, "0")}`;
}

const UNIQUE_VIOLATION = "23505";

export async function createServiceRequest(
  executor: Executor,
  input: NewServiceRequest,
  options: { random?: (max: number) => number } = {},
): Promise<ServiceRequestRow> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      // Cada tentativa num savepoint: dentro de uma transação maior (pedido +
      // alerta), um insert que falha abortaria tudo e o retry nunca rodaria.
      return await executor.transaction(async (tx) => {
        const [row] = await tx
          .insert(serviceRequests)
          .values({ ...input, protocol: generateProtocol(options.random) })
          .returning();
        return row;
      });
    } catch (error) {
      const code = (error as { code?: string; cause?: { code?: string } }).code ??
        (error as { cause?: { code?: string } }).cause?.code;
      if (code !== UNIQUE_VIOLATION) throw error;
    }
  }
  throw new Error("Não foi possível gerar um protocolo único.");
}

export async function listServiceRequests(executor: Executor, options: { status?: ServiceRequestStatus } = {}) {
  return executor.query.serviceRequests.findMany({
    where: options.status ? eq(serviceRequests.status, options.status) : undefined,
    orderBy: [desc(serviceRequests.createdAt)],
  });
}

export async function updateServiceRequestStatus(
  executor: Executor,
  id: string,
  status: string,
): Promise<ServiceRequestRow> {
  if (!(SERVICE_REQUEST_STATUSES as string[]).includes(status)) {
    throw new PermanentError("invalid_status", "Status de orçamento inválido.");
  }
  const [row] = await executor
    .update(serviceRequests)
    .set({ status: status as ServiceRequestStatus, updatedAt: new Date() })
    .where(eq(serviceRequests.id, id))
    .returning();
  if (!row) throw new PermanentError("not_found", "Orçamento não encontrado.");
  return row;
}
