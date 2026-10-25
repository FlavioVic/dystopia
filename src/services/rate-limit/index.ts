/**
 * Serviço de limite de tentativas — responsabilidade única: dizer se uma chave
 * ("login:ip:1.2.3.4") ainda pode tentar dentro da janela.
 *
 * Janela fixa, contada no Postgres: em serverless cada instância tem a própria
 * memória, então um contador em memória seria dividido por N instâncias.
 * O incremento é um único UPSERT — duas requisições simultâneas com a mesma
 * chave serializam no lock da linha e nenhuma contagem se perde. O relógio é o
 * do banco (`now()`), não o de cada instância.
 */

import { lt, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { rateLimits } from "@/db/schema";

export type RateLimitRule = {
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  /** Segundos até a janela atual vencer (0 se já pode tentar). */
  retryAfterSeconds: number;
};

/** Conta uma tentativa para `key` e diz se ela está dentro do limite. */
export async function consumeRateLimit(
  executor: Executor,
  key: string,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  const window = sql`make_interval(secs => ${rule.windowSeconds})`;
  const expired = sql`${rateLimits.windowStartedAt} <= now() - ${window}`;

  const result = await executor.execute<{ hits: number; retry_after: number }>(sql`
    insert into ${rateLimits} (key, hits, window_started_at)
    values (${key}, 1, now())
    on conflict (key) do update set
      hits = case when ${expired} then 1 else ${rateLimits.hits} + 1 end,
      window_started_at = case when ${expired} then now() else ${rateLimits.windowStartedAt} end
    returning
      hits,
      ceil(extract(epoch from (window_started_at + ${window} - now())))::int as retry_after
  `);

  const row = result.rows[0];
  const allowed = row.hits <= rule.limit;
  return { allowed, retryAfterSeconds: allowed ? 0 : Math.max(1, row.retry_after) };
}

/** Apaga janelas que venceram há mais de `olderThanSeconds` (faxina periódica). */
export async function pruneRateLimits(executor: Executor, olderThanSeconds: number): Promise<number> {
  const deleted = await executor
    .delete(rateLimits)
    .where(lt(rateLimits.windowStartedAt, sql`now() - make_interval(secs => ${olderThanSeconds})`))
    .returning({ key: rateLimits.key });
  return deleted.length;
}
