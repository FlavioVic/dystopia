/**
 * Processo do serviço de pagamentos: `npm run worker:payments`.
 *
 * Consome SÓ a fila `payments` do RabbitMQ, com SÓ os handlers de pagamento,
 * e não reconcilia saga nenhuma — ele não sabe que saga existe. Recebe
 * comandos (`payments.authorize`, `payments.refund`) e responde no endereço
 * que veio em cada um, pela outbox (o relay deste processo publica). É o mesmo
 * código-base, mas outro processo: dá para escalar, reiniciar ou derrubar
 * pagamentos sem tocar no resto.
 */

import "dotenv/config";
import { pgPool } from "@/db";
import { createLogger } from "@/lib/logger";
import { closeBroker } from "@/queue/broker";
import { startWorker } from "@/queue/worker";
import { PAYMENTS_QUEUE } from "@/services/payments/contract";
import { cardProvider, paymentHandlers } from "@/services/payments/consumer";

const logger = createLogger("payments");

async function main(): Promise<void> {
  logger.info("gateway de cartão", { provider: cardProvider() });
  const worker = startWorker({
    queues: [PAYMENTS_QUEUE],
    handlers: paymentHandlers,
    prefetch: Number(process.env.WORKER_PREFETCH ?? 5),
    relayEveryMs: Number(process.env.WORKER_RELAY_MS ?? 500),
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
  logger.error("worker de pagamentos morreu", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
