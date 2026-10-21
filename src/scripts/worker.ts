/**
 * Processo do worker: `npm run worker`.
 *
 * Fica escutando a fila (`jobs`) e avançando sagas. Dá pra subir vários em
 * paralelo — a fila é segura pra concorrência. Encerra limpo em Ctrl+C /
 * SIGTERM: termina o tick atual, fecha o pool e sai.
 */

import "dotenv/config";
import { pgPool } from "@/db";
import { createLogger } from "@/lib/logger";
import { startWorker } from "@/queue/worker";

const logger = createLogger("worker");

async function main(): Promise<void> {
  const worker = startWorker({
    queues: (process.env.WORKER_QUEUES ?? "default")
      .split(",")
      .map((queue) => queue.trim())
      .filter(Boolean),
    batchSize: Number(process.env.WORKER_BATCH_SIZE ?? 5),
    pollMs: Number(process.env.WORKER_POLL_MS ?? 1_000),
    reconcileEveryMs: Number(process.env.WORKER_RECONCILE_MS ?? 30_000),
  });

  let shuttingDown = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info(`${signal} recebido, encerrando…`);
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
