/**
 * Processo do worker: `npm run worker`.
 *
 * Consome o RabbitMQ (push, com prefetch), publica a outbox (relay) e roda a
 * reconciliação e a faxina periodicamente. Dá pra subir vários em paralelo: o
 * broker entrega cada mensagem a um consumidor só, o relay usa SKIP LOCKED e
 * a saga tem lease. Encerra limpo em Ctrl+C / SIGTERM: para de receber,
 * termina (e confirma) o que já pegou, fecha broker e pool.
 *
 * Pagamentos roda em processo próprio (`npm run worker:payments`). Pra um
 * deploy com um container só, `WORKER_QUEUES=saga,notifications,payments`
 * faz este processo consumir as três filas.
 */

import "dotenv/config";
import { housekeeping, workerHandlers } from "@/composition/worker";
import { pgPool } from "@/db";
import { createLogger } from "@/lib/logger";
import { closeBroker } from "@/queue/broker";
import { startWorker } from "@/queue/worker";
import { SAGA_QUEUE } from "@/saga/messaging";
import { reconcile } from "@/saga/reconcile";
import { emailProvider } from "@/services/notifications/delivery";
import { NOTIFICATIONS_QUEUE } from "@/services/notifications";
import { cardProvider } from "@/services/payments/consumer";
import { PAYMENTS_QUEUE } from "@/services/payments/contract";

const logger = createLogger("worker");

async function main(): Promise<void> {
  const queues = (process.env.WORKER_QUEUES ?? `${SAGA_QUEUE},${NOTIFICATIONS_QUEUE}`)
    .split(",")
    .map((queue) => queue.trim())
    .filter(Boolean);
  if (queues.includes(PAYMENTS_QUEUE)) logger.info("gateway de cartão", { provider: cardProvider() });
  // Config de e-mail errada derruba aqui, não na primeira confirmação.
  logger.info("entrega de e-mail", { provider: emailProvider() });

  const worker = startWorker({
    queues,
    handlers: workerHandlers(),
    prefetch: Number(process.env.WORKER_PREFETCH ?? 5),
    relayEveryMs: Number(process.env.WORKER_RELAY_MS ?? 500),
    periodic: [
      { name: "reconcile", everyMs: Number(process.env.WORKER_RECONCILE_MS ?? 30_000), run: () => reconcile() },
      { name: "housekeeping", everyMs: 60 * 60 * 1_000, run: housekeeping },
    ],
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
  await closeBroker();
  await pgPool.end();
}

main().catch((error) => {
  logger.error("worker morreu", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
