/**
 * Worker da fila.
 *
 * Roda fora do Next (`npm run worker`) e é o executor durável da orquestração:
 * pega jobs prontos, chama o handler, e cuida de retry/dead-letter. Pode
 * rodar em N processos — `claim()` usa `FOR UPDATE SKIP LOCKED`, então não
 * existe job processado duas vezes em paralelo.
 *
 * `processOnce` é exposto separado do loop pra poder ser chamado nos testes
 * (e no caminho inline do checkout) sem subir processo nenhum.
 */

import { randomUUID } from "node:crypto";
import { createLogger } from "@/lib/logger";
import { errorMessage } from "@/saga/errors";
import { reconcile } from "@/saga/reconcile";
import * as queue from "./index";
import { getHandler } from "./handlers";

const logger = createLogger("queue:worker");

export type WorkerOptions = {
  workerId?: string;
  queues?: string[];
  batchSize?: number;
  leaseMs?: number;
  /** Intervalo entre buscas quando a fila está vazia. */
  pollMs?: number;
  /** Intervalo da reconciliação. */
  reconcileEveryMs?: number;
};

export type TickReport = {
  claimed: number;
  completed: number;
  failed: number;
  unknown: number;
};

export function defaultWorkerId(): string {
  return `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
}

/** Processa um lote de jobs. Retorna o que aconteceu (usado em testes). */
export async function processOnce(options: WorkerOptions = {}): Promise<TickReport> {
  const workerId = options.workerId ?? defaultWorkerId();
  const jobs = await queue.claim({
    workerId,
    limit: options.batchSize ?? 5,
    queues: options.queues,
    leaseMs: options.leaseMs,
  });

  const report: TickReport = { claimed: jobs.length, completed: 0, failed: 0, unknown: 0 };

  for (const job of jobs) {
    const handler = getHandler(job.type);

    if (!handler) {
      report.unknown += 1;
      logger.error("job sem handler", { jobId: job.id, type: job.type });
      await queue.fail(job.id, `Nenhum handler registrado para "${job.type}"`);
      continue;
    }

    try {
      const result = await handler(job);
      if (!result.settled) await queue.complete(job.id);
      report.completed += 1;
    } catch (error) {
      report.failed += 1;
      const message = errorMessage(error);
      const outcome = await queue.fail(job.id, message);
      const fields = { jobId: job.id, type: job.type, attempts: job.attempts, status: outcome.status, error: message };
      // Dead-letter é nível error de propósito: é a linha que um alerta de log
      // (Railway, Datadog…) filtra. Falha com tentativa sobrando é só aviso.
      if (outcome.status === "dead") logger.error("job foi pra dead-letter", fields);
      else logger.warn("job falhou", fields);
    }
  }

  return report;
}

/**
 * Drena a fila até não sobrar job pronto (ou até estourar o orçamento de
 * tempo). Útil no caminho inline e nos testes de integração.
 */
export async function drainQueue(
  options: WorkerOptions & { budgetMs?: number; maxTicks?: number } = {},
): Promise<TickReport> {
  const budgetMs = options.budgetMs ?? 5_000;
  const maxTicks = options.maxTicks ?? 50;
  const startedAt = Date.now();
  const total: TickReport = { claimed: 0, completed: 0, failed: 0, unknown: 0 };

  for (let tick = 0; tick < maxTicks; tick += 1) {
    if (Date.now() - startedAt > budgetMs) break;
    const report = await processOnce(options);
    total.claimed += report.claimed;
    total.completed += report.completed;
    total.failed += report.failed;
    total.unknown += report.unknown;
    if (report.claimed === 0) break;
  }

  return total;
}

export type WorkerHandle = {
  /** Encerra o loop depois do tick atual. */
  stop: () => void;
  /** Promessa que resolve quando o loop terminou de verdade. */
  done: Promise<void>;
};

export function startWorker(options: WorkerOptions = {}): WorkerHandle {
  const workerId = options.workerId ?? defaultWorkerId();
  const pollMs = options.pollMs ?? 1_000;
  const reconcileEveryMs = options.reconcileEveryMs ?? 30_000;

  let running = true;
  let wake: (() => void) | null = null;

  const stop = () => {
    running = false;
    wake?.();
  };

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wake = null;
        resolve();
      }, ms);
      wake = () => {
        clearTimeout(timer);
        wake = null;
        resolve();
      };
    });

  const done = (async () => {
    logger.info("worker iniciado", { workerId, queues: options.queues ?? ["default"], pollMs });
    let lastReconcile = 0;

    while (running) {
      try {
        if (Date.now() - lastReconcile >= reconcileEveryMs) {
          lastReconcile = Date.now();
          await reconcile();
        }

        const report = await processOnce({ ...options, workerId });
        if (report.claimed === 0) await sleep(pollMs);
      } catch (error) {
        logger.error("tick do worker falhou", { workerId, error: errorMessage(error) });
        await sleep(pollMs);
      }
    }

    logger.info("worker encerrado", { workerId });
  })();

  return { stop, done };
}
