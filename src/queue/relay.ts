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
import { errorMessage, rootCauseMessage } from "@/shared/errors";
import { backoffMs, nextRunAt } from "./backoff";
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

/**
 * Uma caixa de saída com nome. O nome é o que o log, o painel e o alerta
 * mostram quando o banco dela some ("pagamentos" inacessível).
 */
export type NamedOutbox = { name: string; database: OutboxDatabase };

export type RelayAllReport = RelayReport & {
  /** Outboxes cujo banco não respondeu (agora ou na pausa depois de falhar). */
  unreachable: string[];
};

/** Pausa de uma outbox fora do ar antes da próxima tentativa: 1 s, 2 s… até 30 s. */
const UNREACHABLE_BACKOFF = { baseMs: 1_000, maxMs: 30_000 };

/**
 * Relay de várias outboxes, cada uma isolada (bulkhead): o banco de uma fora
 * do ar não impede as outras de publicar, nem derruba quem chamou — o dreno,
 * o worker. Incidente de 2026-10-31: a URL do banco de pagamentos quebrada
 * fazia o relay lançar ANTES do dreno, e todo checkout ficava em
 * "processando", inclusive o que não dependia de pagamentos.
 *
 * Erro do BROKER não chega aqui: `relayOutbox` já o trata (backoff por linha).
 * O que escapa dele é o banco da outbox — por isso "inacessível".
 *
 * Guarda estado entre chamadas (crie um por dreno ou por worker): outbox que
 * falhou fica de fora por um backoff, em vez de custar uma tentativa de
 * conexão a cada volta do laço, e o log sai só na mudança — caiu (error) e
 * voltou (info) —, não a cada 200 ms.
 */
export function createRelay(
  outboxes: NamedOutbox[],
  options: { maxBatches?: number; clock?: () => number } = {},
): () => Promise<RelayAllReport> {
  const clock = options.clock ?? Date.now;
  const down = new Map<string, { failures: number; since: number; retryAt: number }>();

  return async () => {
    const total: RelayAllReport = { published: 0, failed: 0, unreachable: [] };
    for (const { name, database } of outboxes) {
      const state = down.get(name);
      if (state && clock() < state.retryAt) {
        total.unreachable.push(name);
        continue;
      }
      try {
        for (let batch = 0; batch < (options.maxBatches ?? 20); batch += 1) {
          const report = await relayOutbox(database);
          total.published += report.published;
          total.failed += report.failed;
          if (report.published === 0) break;
        }
        if (state) {
          down.delete(name);
          logger.info("outbox voltou a responder", { outbox: name, downForMs: clock() - state.since });
        }
      } catch (error) {
        const failures = (state?.failures ?? 0) + 1;
        down.set(name, {
          failures,
          since: state?.since ?? clock(),
          retryAt: clock() + backoffMs(failures, UNREACHABLE_BACKOFF),
        });
        total.unreachable.push(name);
        // Nível error de propósito (é a linha que um alerta de log filtra),
        // mas uma vez só por queda.
        if (!state) {
          logger.error("outbox inacessível; as outras seguem publicando", { outbox: name, error: rootCauseMessage(error) });
        }
      }
    }
    return total;
  };
}

/** Uma passada só, sem memória entre chamadas (rodada avulsa, teste). */
export function relayAll(outboxes: NamedOutbox[], options: { maxBatches?: number } = {}): Promise<RelayAllReport> {
  return createRelay(outboxes, options)();
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
