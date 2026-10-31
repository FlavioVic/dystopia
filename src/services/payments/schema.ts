/**
 * Banco do serviço de pagamentos — separado do banco da loja
 * (`PAYMENTS_DATABASE_URL`, com migrations próprias em `drizzle-payments/`).
 *
 * Nada aqui aponta para tabela da loja: o pedido é só um id (`order_id`), sem
 * chave estrangeira — ele mora em outro banco. Quem precisa saber da cobrança
 * pergunta por mensagem (contract.ts); o pedido guarda o resumo que veio na
 * resposta.
 *
 * Imports relativos (não `@/`): o drizzle-kit carrega este arquivo sem o
 * alias do tsconfig.
 */

import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { PAYMENT_METHODS } from "./contract";

// Caixa de saída do próprio banco: a resposta de uma cobrança commita junto
// com ela, aqui, e o relay deste processo publica.
export { outbox } from "../../db/outbox";

export const paymentMethodEnum = pgEnum("payment_method", PAYMENT_METHODS);

export const paymentStatusEnum = pgEnum("payment_status", ["pending", "authorized", "paid", "failed", "refunded"]);

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Id do pedido na loja — referência por valor, não chave estrangeira.
  orderId: uuid("order_id").notNull(),
  provider: text("provider").notNull(), // "stripe", "simulado"...
  method: paymentMethodEnum("method").notNull(),
  status: paymentStatusEnum("status").notNull().default("pending"),
  amountCents: integer("amount_cents").notNull(),
  transactionId: text("transaction_id"),
  // Chave de idempotência enviada ao provedor: reprocessar o comando de
  // cobrança não cria uma segunda cobrança (unique index abaixo).
  idempotencyKey: text("idempotency_key"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("payments_order_id_idx").on(table.orderId),
  uniqueIndex("payments_idempotency_key_unique_idx").on(table.idempotencyKey),
]);
