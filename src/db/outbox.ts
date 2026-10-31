import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Transactional outbox: a mensagem é gravada na MESMA transação do fato de
 * negócio e o relay (`src/queue/relay.ts`) publica no RabbitMQ depois do
 * commit, com publisher confirm. Só marca `published_at` quando o broker
 * confirmou; publicação que falha fica aqui e é tentada de novo com backoff.
 * Entrega é "pelo menos uma vez": o consumidor tem que ser idempotente.
 */
export const outbox = pgTable("outbox", {
  // Vira o `messageId` no broker: é a chave de idempotência da mensagem.
  id: uuid("id").primaryKey().defaultRandom(),
  queue: text("queue").notNull(), // fila lógica de destino: "saga", "payments"...
  type: text("type").notNull(), // "saga.advance", "payments.authorize"...
  payload: jsonb("payload").notNull().default({}),
  // Tentativas de PROCESSAMENTO que o consumidor pode gastar antes da DLQ.
  maxAttempts: integer("max_attempts").notNull().default(5),
  // Entrega adiada (ex.: retry de passo da saga): sai pela fila de espera.
  delayMs: integer("delay_ms").notNull().default(0),
  // Tentativas de PUBLICAÇÃO (broker fora do ar), com backoff.
  publishAttempts: integer("publish_attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  lastError: text("last_error"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // O relay só olha o que falta publicar: índice parcial, fica pequeno.
  index("outbox_unpublished_idx").on(table.nextAttemptAt).where(sql`published_at is null`),
]);

