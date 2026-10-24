/**
 * Processo do worker: `npm run worker`.
 *
 * Fica escutando a fila (`jobs`) e avançando sagas. Dá pra subir vários em
 * paralelo — a fila é segura pra concorrência. Encerra limpo em Ctrl+C /
 * SIGTERM: termina o tick atual, fecha o pool e sai.
 *
 * Pagamentos roda em processo próprio (`npm run worker:payments`). Pra um
 * deploy com um container só, `WORKER_QUEUES=default,payments` faz este
 * processo consumir as duas filas — por isso ele também conhece os handlers
 * de pagamento (só são usados se a fila `payments` estiver na lista).
 */

import "dotenv/config";
import { workerHandlers } from "@/composition/worker";
import { db as pgDb, pgPool } from "@/db";
import { createLogger } from "@/lib/logger";
import { startWorker } from "@/queue/worker";
import { emailProvider } from "@/services/notifications/delivery";
import { cardProvider } from "@/services/payments/consumer";
import { pruneRateLimits } from "@/services/rate-limit";

const logger = createLogger("worker");

const PRUNE_EVERY_MS = 60 * 60 * 1_000;

/** Faxina do limite de tentativas: só o worker é processo de longa duração. */
async function pruneOldRateLimits(): Promise<void> {
  try {
    const removed = await pruneRateLimits(pgDb, 24 * 60 * 60);
    if (removed > 0) logger.info("janelas de rate limit apagadas", { removed });
  } catch (error) {
    logger.warn("faxina de rate limit falhou", { error: error instanceof Error ? error.message : String(error) });
  }
}

async function main(): Promise<void> {
  const queues = (process.env.WORKER_QUEUES ?? "default")
    .split(",")
    .map((queue) => queue.trim())
    .filter(Boolean);
  if (queues.includes("payments")) logger.info("gateway de cartão", { provider: cardProvider() });
  // Config de e-mail errada derruba aqui, não na primeira confirmação.
  logger.info("entrega de e-mail", { provider: emailProvider() });

  const worker = startWorker({
    queues,
    batchSize: Number(process.env.WORKER_BATCH_SIZE ?? 5),
    pollMs: Number(process.env.WORKER_POLL_MS ?? 1_000),
    reconcileEveryMs: Number(process.env.WORKER_RECONCILE_MS ?? 30_000),
    handlers: workerHandlers(),
  });

  void pruneOldRateLimits();
  const pruneTimer = setInterval(() => void pruneOldRateLimits(), PRUNE_EVERY_MS);

  let shuttingDown = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info(`${signal} recebido, encerrando…`);
      clearInterval(pruneTimer);
      worker.stop();
    });
  }

  await worker.done;
  await pgPool.end();
}

main().catch((error) => {
  logger.error("worker morreu", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
