/**
 * Relay da outbox → RabbitMQ (padrão "polling publisher").
 *
 * Pega um lote do que falta publicar com `FOR UPDATE SKIP LOCKED` (vários
 * relays em paralelo não publicam a mesma linha), publica com publisher
 * confirm e só então marca `published_at`, na mesma transação que segurou as
 * linhas. Se o broker não confirmar, nada é marcado: as linhas ganham
 * `publish_attempts` + backoff e voltam no próximo ciclo.
 *
 * Duplicata é possível (broker confirmou, o commit do `published_at` falhou)
 * e é aceita de propósito: a entrega já é "pelo menos uma vez" e o consumidor
 * é idempotente. Perda não é possível.
 */

import { and, asc, eq, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import type { Database, Transaction } from "@/db";
import { outbox } from "@/db/outbox";
import { createLogger } from "@/lib/logger";
import { errorMessage } from "@/shared/errors";
import { nextRunAt } from "./backoff";
import { getBroker, publishEnvelope } from "./broker";

const logger = createLogger("queue:relay");

/** Backoff da PUBLICAÇÃO (broker fora): até 1 min entre tentativas. */
const PUBLISH_BACKOFF = { baseMs: 1_000, maxMs: 60_000 };

export type RelayReport = { published: number; failed: number };

/**
 * Um banco com a tabela `outbox` — a loja ou pagamentos, cada um publica a
 * própria caixa de saída; quem monta o processo diz quais. Descrito só pelo
 * que o relay usa, para servir aos dois schemas.
 */
export type OutboxDatabase = {
  transaction<T>(run: (tx: Pick<Transaction, "select" | "update">) => Promise<T>): Promise<T>;
  select: Database["select"];
  delete: Database["delete"];
};

export async function relayOutbox(
  database: OutboxDatabase,
  options: { limit?: number; now?: Date } = {},
): Promise<RelayReport> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 100;

  // "Já pode publicar?" pelo relógio do BANCO, o mesmo que gravou o
  // `next_attempt_at` (default `now()`, em microssegundos). Com o `Date` do
  // Node (milissegundos, e às vezes de outra máquina), uma linha gravada no
  // mesmo milissegundo do relay ficava alguns microssegundos "no futuro" e
  // pulava a rodada — no checkout da Vercel, o pedido esperava a próxima
  // drenagem. `options.now` continua valendo para teste com relógio fixo.
  const due = options.now ? lte(outbox.nextAttemptAt, options.now) : lte(outbox.nextAttemptAt, sql`now()`);

  const report = await database.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(outbox)
      .where(and(isNull(outbox.publishedAt), due))
      .orderBy(asc(outbox.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (rows.length === 0) return { published: 0, failed: 0 };

    try {
      const broker = await getBroker();
      for (const row of rows) {
        const envelope = {
          id: row.id,
          queue: row.queue,
          type: row.type,
          payload: (row.payload ?? {}) as Record<string, unknown>,
          attempts: 0,
          maxAttempts: row.maxAttempts,
        };
        await publishEnvelope(broker, envelope, row.delayMs > 0 ? { to: "retry", delayMs: row.delayMs } : { to: "work" });
      }
      await broker.publisher.waitForConfirms();
    } catch (error) {
      const message = errorMessage(error);
      for (const row of rows) {
        await tx
          .update(outbox)
          .set({
            publishAttempts: row.publishAttempts + 1,
            nextAttemptAt: nextRunAt(row.publishAttempts + 1, now, PUBLISH_BACKOFF),
            lastError: message.slice(0, 2_000),
          })
          .where(eq(outbox.id, row.id));
      }
      logger.warn("publicação no broker falhou; a outbox tenta de novo", { messages: rows.length, error: message });
      return { published: 0, failed: rows.length };
    }

    await tx
      .update(outbox)
      .set({ publishedAt: new Date(), lastError: null })
      .where(inArray(outbox.id, rows.map((row) => row.id)));
    return { published: rows.length, failed: 0 };
  });

  if (report.published > 0) logger.debug("outbox publicada", report);
  return report;
}

/** Publica até não sobrar nada pronto (ou até o broker recusar), em cada outbox. */
export async function relayAll(
  outboxes: OutboxDatabase[],
  options: { maxBatches?: number } = {},
): Promise<RelayReport> {
  const total: RelayReport = { published: 0, failed: 0 };
  for (const database of outboxes) {
    for (let batch = 0; batch < (options.maxBatches ?? 20); batch += 1) {
      const report = await relayOutbox(database);
      total.published += report.published;
      total.failed += report.failed;
      if (report.published === 0) break;
    }
  }
  return total;
}

/** Faxina: o que já foi publicado há mais de `olderThanMs` sai da outbox. */
export async function pruneOutbox(
  database: OutboxDatabase,
  olderThanMs: number,
  now: Date = new Date(),
): Promise<number> {
  const rows = await database
    .delete(outbox)
    .where(lt(outbox.publishedAt, new Date(now.getTime() - olderThanMs)))
    .returning({ id: outbox.id });
  return rows.length;
}
