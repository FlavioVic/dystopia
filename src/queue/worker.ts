/**
 * Consumidor da fila. `handleDelivery` é a política de retentativa, igual
 * para toda mensagem (tabela em docs/ARQUITETURA.md › A fila): ok → ack;
 * transitório → fila de espera do backoff; permanente/esgotado/ilegível/sem
 * handler → DLQ. O `ack` vem DEPOIS de encaminhar com confirmação: crash =
 * reentrega, nunca perda.
 *
 * Push (`startWorker`, processo de pé) e pull (`drainQueues`, Vercel e
 * testes) usam o mesmo `handleDelivery`.
 */

import { randomUUID } from "node:crypto";
import type { Channel, ConsumeMessage, GetMessage } from "amqplib";
import { createLogger } from "@/lib/logger";
import { errorMessage, isRetryable, rootCauseMessage } from "@/shared/errors";
import { backoffMs } from "./backoff";
import { declareQueue, getBroker, names, publishEnvelope, queueDepths, readEnvelope, type Envelope } from "./broker";
import type { MessageHandler, QueueMessage } from "./index";
import { createRelay, type NamedOutbox } from "./relay";

const logger = createLogger("queue:worker");

export type Handlers = Record<string, MessageHandler>;

export type Outcome = "acked" | "retried" | "dead";

export type DrainReport = {
  received: number;
  acked: number;
  retried: number;
  dead: number;
};

const emptyReport = (): DrainReport => ({ received: 0, acked: 0, retried: 0, dead: 0 });

export function defaultWorkerId(): string {
  return `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
}

/**
 * Decide o destino de UMA mensagem e a encaminha. Não dá `ack` — quem
 * recebeu (push ou pull) dá, depois que isto voltou sem erro.
 */
export async function handleDelivery(
  queue: string,
  raw: ConsumeMessage | GetMessage,
  handlers: Handlers,
): Promise<Outcome> {
  const broker = await getBroker();
  const envelope = readEnvelope(queue, raw);

  if (!envelope) {
    // Ilegível não melhora com retry: vai direto para o parking lot como veio.
    logger.error("mensagem ilegível foi para DLQ", { queue, messageId: raw.properties.messageId });
    const n = names(queue, broker.config);
    broker.publisher.publish(n.deadExchange, queue, raw.content, { ...raw.properties, persistent: true });
    await broker.publisher.waitForConfirms();
    return "dead";
  }

  const route = async (next: Envelope, to: "retry" | "dead", delayMs = 0): Promise<void> => {
    await publishEnvelope(broker, next, to === "retry" ? { to, delayMs } : { to });
    await broker.publisher.waitForConfirms();
  };

  const handler = handlers[envelope.type];
  if (!handler) {
    const error = `Nenhum handler registrado para "${envelope.type}" na fila ${queue}`;
    logger.error("mensagem sem handler foi para DLQ", { messageId: envelope.id, type: envelope.type });
    await route({ ...envelope, lastError: error }, "dead");
    return "dead";
  }

  const message: QueueMessage = {
    id: envelope.id,
    queue,
    type: envelope.type,
    payload: envelope.payload,
    attempt: envelope.attempts + 1,
    maxAttempts: envelope.maxAttempts,
  };

  try {
    const result = await handler(message);
    if (!result) return "acked";
    const attempts = result.countAttempt === false ? envelope.attempts : envelope.attempts + 1;
    if (attempts >= envelope.maxAttempts) {
      await route({ ...envelope, attempts, lastError: "tentativas esgotadas" }, "dead");
      return "dead";
    }
    await route({ ...envelope, attempts }, "retry", result.retryInMs);
    return "retried";
  } catch (error) {
    // A causa, não o embrulho: erro de banco vem do Drizzle como "Failed
    // query: <sql> params: <…>", que esconde o motivo (ENOTFOUND, senha) e
    // levaria dado do cliente para o log e para o cabeçalho da DLQ.
    const reason = rootCauseMessage(error);
    const fields = { messageId: envelope.id, type: envelope.type, attempt: message.attempt, error: reason };

    if (!isRetryable(error) || message.attempt >= envelope.maxAttempts) {
      await route({ ...envelope, attempts: message.attempt, lastError: reason }, "dead");
      // Nível error de propósito: é a linha que um alerta de log filtra.
      logger.error("mensagem foi para DLQ", fields);
      return "dead";
    }

    await route({ ...envelope, attempts: message.attempt, lastError: reason }, "retry", backoffMs(message.attempt));
    logger.warn("mensagem falhou, vai tentar de novo", fields);
    return "retried";
  }
}

function count(report: DrainReport, outcome: Outcome): void {
  report.received += 1;
  report[outcome] += 1;
}

// ---------------------------------------------------------------------------
// Pull: drena com orçamento de tempo (Vercel, testes)
// ---------------------------------------------------------------------------

export type DrainOptions = {
  queues: string[];
  handlers: Handlers;
  /** Outboxes que este dreno publica (a da loja, a de pagamentos, ou as duas). */
  outboxes: NamedOutbox[];
  /** Tempo máximo drenando. */
  budgetMs?: number;
  /** Teto de mensagens processadas numa chamada. */
  maxMessages?: number;
  /**
   * Com tudo vazio, se ainda há mensagem nas filas de espera (retry em
   * backoff), espera ela voltar em vez de sair — dentro do orçamento. É o que
   * deixa o worker embutido levar um retry até o fim sem processo de pé.
   *
   * E só sai depois de `quietMs` sem nada pronto nem esperando: mensagem que
   * OUTRO consumidor está segurando (pegou, ainda sem ack) não aparece em
   * contagem nenhuma do broker, e pode virar retry daqui a pouco — é o caso
   * da Vercel, onde o dreno da página do pedido corre junto do dreno do
   * checkout.
   */
  waitForScheduled?: boolean;
  /** Silêncio exigido antes de sair, no modo que espera. */
  quietMs?: number;
  /** Intervalo entre olhadas enquanto espera retry. */
  idleMs?: number;
};

export async function drainQueues(options: DrainOptions): Promise<DrainReport> {
  const budgetMs = options.budgetMs ?? 5_000;
  const maxMessages = options.maxMessages ?? 500;
  const startedAt = Date.now();
  const report = emptyReport();
  const elapsed = () => Date.now() - startedAt;
  let quietSince: number | null = null;

  // Uma outbox fora do ar não para o dreno: o relay a isola e a pula pelo
  // backoff dele; as filas seguem sendo consumidas.
  const relay = createRelay(options.outboxes);

  const broker = await getBroker();
  const channel = await broker.connection.createChannel();
  try {
    for (const queue of options.queues) await declareQueue(broker, queue);

    while (elapsed() < budgetMs && report.received < maxMessages) {
      // Handler grava mensagem nova na outbox (resposta, próximo passo): o
      // relay roda a cada volta para ela entrar no mesmo dreno.
      await relay();

      let got = 0;
      for (const queue of options.queues) {
        const raw = await channel.get(names(queue, broker.config).work, { noAck: false });
        if (!raw) continue;
        got += 1;
        await settle(channel, raw, () => handleDelivery(queue, raw, options.handlers), report);
      }
      if (got > 0) {
        quietSince = null;
        continue;
      }

      if (!options.waitForScheduled) break;
      const depths = await queueDepths(options.queues);
      const soonest = depths
        .map((depth) => depth.soonestRetryMs)
        .filter((ms): ms is number => ms !== null)
        .sort((a, b) => a - b)[0];
      if (soonest === undefined) {
        quietSince ??= Date.now();
        if (Date.now() - quietSince >= (options.quietMs ?? 1_500)) break;
      } else {
        quietSince = null;
        // Retry que só volta depois do orçamento: não adianta dormir por ele.
        if (elapsed() + soonest > budgetMs) break;
      }
      await sleep(options.idleMs ?? 200);
    }
  } finally {
    await channel.close().catch(() => {});
  }

  return report;
}

/** Processa e dá `ack`; se o encaminhamento falhar, devolve a mensagem para o broker. */
async function settle(
  channel: Channel,
  raw: ConsumeMessage | GetMessage,
  run: () => Promise<Outcome>,
  report: DrainReport,
): Promise<void> {
  try {
    count(report, await run());
    channel.ack(raw);
  } catch (error) {
    // Não conseguiu nem encaminhar (broker caiu no meio): `nack` com requeue
    // devolve a mensagem intacta — reentrega, não perda.
    logger.error("falha ao encaminhar mensagem; devolvida ao broker", { error: errorMessage(error) });
    try {
      channel.nack(raw, false, true);
    } catch {
      // canal já fechado: o broker reentrega sozinho o que não teve ack
    }
  }
}

// ---------------------------------------------------------------------------
// Push: processo de longa duração
// ---------------------------------------------------------------------------

export type WorkerOptions = {
  workerId?: string;
  queues: string[];
  handlers: Handlers;
  /** Mensagens em processamento ao mesmo tempo, por fila. */
  prefetch?: number;
  /** Intervalo do relay da outbox. */
  relayEveryMs?: number;
  /** Outboxes que este processo publica (a da loja, a de pagamentos, ou as duas). */
  outboxes: NamedOutbox[];
  /** Tarefas periódicas extras (reconciliação, faxina). */
  periodic?: Array<{ name: string; everyMs: number; run: () => Promise<unknown> }>;
};

export type WorkerHandle = {
  /** Para de consumir, espera o que está em processamento e fecha. */
  stop: () => void;
  done: Promise<void>;
};

export function startWorker(options: WorkerOptions): WorkerHandle {
  const workerId = options.workerId ?? defaultWorkerId();
  // Um relay pelo processo inteiro: a memória de qual outbox está fora
  // sobrevive às reconexões com o broker.
  const relay = createRelay(options.outboxes);
  let running = true;
  let wake: (() => void) | null = null;

  const stop = () => {
    running = false;
    wake?.();
  };

  const sleepUnlessStopped = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  /** Uma sessão: conecta, consome até a conexão cair ou pedirem para parar. */
  const session = async () => {
    const broker = await getBroker();
    const channel = await broker.connection.createChannel();
    await channel.prefetch(options.prefetch ?? 5);
    const inFlight = new Set<Promise<void>>();
    const report = emptyReport();

    const closed = new Promise<void>((resolve) => {
      channel.on("close", resolve);
      broker.connection.on("close", resolve);
    });

    const tags: string[] = [];
    for (const queue of options.queues) {
      await declareQueue(broker, queue);
      const { consumerTag } = await channel.consume(names(queue, broker.config).work, (raw) => {
        if (!raw) return; // consumidor cancelado pelo broker (fila apagada)
        const task = settle(channel, raw, () => handleDelivery(queue, raw, options.handlers), report).finally(() =>
          inFlight.delete(task),
        );
        inFlight.add(task);
      });
      tags.push(consumerTag);
    }
    logger.info("consumindo", { workerId, queues: options.queues, prefetch: options.prefetch ?? 5 });

    const timers = startPeriodic(options, workerId, relay);
    await Promise.race([closed, new Promise<void>((resolve) => (wake = resolve))]);
    for (const timer of timers) clearInterval(timer);

    // Parada pedida: para de receber e termina o que já pegou (ack incluso).
    for (const tag of tags) await channel.cancel(tag).catch(() => {});
    await Promise.allSettled([...inFlight]);
    await channel.close().catch(() => {});
  };

  const done = (async () => {
    logger.info("worker iniciado", { workerId, queues: options.queues });
    let failures = 0;
    while (running) {
      try {
        await session();
        failures = 0;
      } catch (error) {
        failures += 1;
        logger.error("sessão com o broker caiu; reconectando", { workerId, error: errorMessage(error) });
      }
      // Reconexão com backoff: broker reiniciando não vira laço apertado.
      if (running) await sleepUnlessStopped(backoffMs(Math.max(1, failures), { baseMs: 1_000, maxMs: 30_000 }));
    }
    logger.info("worker encerrado", { workerId });
  })();

  return { stop, done };
}

function startPeriodic(options: WorkerOptions, workerId: string, relay: () => Promise<unknown>): NodeJS.Timeout[] {
  const tasks = [
    { name: "relay", everyMs: options.relayEveryMs ?? 500, run: relay },
    ...(options.periodic ?? []),
  ];
  return tasks.map((task) => {
    let busy = false;
    return setInterval(() => {
      if (busy) return; // tarefa lenta não empilha execução
      busy = true;
      task
        .run()
        .catch((error) => logger.warn(`tarefa periódica falhou: ${task.name}`, { workerId, error: errorMessage(error) }))
        .finally(() => {
          busy = false;
        });
    }, task.everyMs);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
