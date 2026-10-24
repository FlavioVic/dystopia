/**
 * Conexão com o RabbitMQ e a topologia das filas.
 *
 * Cada fila lógica (`saga`, `payments`, `notifications`…) vira, no broker:
 *
 *   exchange <p>         (direct) ──rk=<fila>──▶ <p>.<fila>              trabalho
 *   exchange <p>.retry   (direct) ──rk=<fila>.<ms>──▶ <p>.<fila>.retry.<ms>
 *        fila de espera com x-message-ttl=<ms>; quando o TTL vence, o
 *        dead-letter-exchange dela devolve a mensagem pra <p>.<fila>
 *   exchange <p>.dead    (direct) ──rk=<fila>──▶ <p>.<fila>.dlq          parking lot
 *
 * É o padrão "retry com dead-letter exchange + TTL": uma fila de espera POR
 * ATRASO (e não TTL por mensagem) porque o RabbitMQ só expira a mensagem que
 * está na cabeça da fila — uma de 2 min na frente seguraria uma de 1 s.
 *
 * `<p>` é o prefixo (`RABBITMQ_PREFIX`): os testes usam outro e não encostam
 * nas filas de dev.
 */

import { connect, type Channel, type ChannelModel, type ConfirmChannel } from "amqplib";
import { createLogger } from "@/lib/logger";

const logger = createLogger("queue:broker");

const DEV_URL = "amqp://dystopia:dystopia_dev_pw@localhost:5672";
export const DEFAULT_RETRY_TIERS_MS = [1_000, 5_000, 30_000, 120_000];

export type BrokerConfig = { url: string; prefix: string; retryTiersMs: number[] };

export function brokerConfig(): BrokerConfig {
  const url = process.env.RABBITMQ_URL;
  if (!url && process.env.NODE_ENV === "production") {
    throw new Error("RABBITMQ_URL não configurada.");
  }
  const tiers = (process.env.RABBITMQ_RETRY_TIERS_MS ?? "")
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isInteger(v) && v > 0)
    .sort((a, b) => a - b);
  return {
    url: url ?? DEV_URL,
    prefix: process.env.RABBITMQ_PREFIX || "dystopia",
    retryTiersMs: tiers.length > 0 ? tiers : DEFAULT_RETRY_TIERS_MS,
  };
}

/** Nomes no broker de uma fila lógica. */
export function names(queue: string, config: BrokerConfig = brokerConfig()) {
  const p = config.prefix;
  return {
    exchange: p,
    retryExchange: `${p}.retry`,
    deadExchange: `${p}.dead`,
    work: `${p}.${queue}`,
    dead: `${p}.${queue}.dlq`,
    retry: (ms: number) => `${p}.${queue}.retry.${ms}`,
    retryKey: (ms: number) => `${queue}.${ms}`,
  };
}

/**
 * Menor fila de espera que cobre o atraso pedido (ou a maior que existe).
 * Atraso arredonda PRA CIMA: retry nunca sai antes da hora.
 */
export function retryTierFor(delayMs: number, tiers: number[] = brokerConfig().retryTiersMs): number {
  return tiers.find((tier) => tier >= delayMs) ?? tiers[tiers.length - 1];
}

type Broker = {
  connection: ChannelModel;
  /** Canal de publicação: com confirmação do broker (publisher confirms). */
  publisher: ConfirmChannel;
  /** Filas lógicas cuja topologia já foi declarada nesta conexão. */
  declared: Map<string, Promise<void>>;
  config: BrokerConfig;
};

let current: Promise<Broker> | null = null;

/**
 * Conexão do processo (uma só, reaproveitada). Se cair, a próxima chamada
 * reconecta — quem estava no meio de uma operação recebe o erro e o trata
 * como transitório (relay tenta de novo, consumidor reinicia).
 */
export function getBroker(): Promise<Broker> {
  if (!current) {
    const opening = open();
    current = opening;
    opening.catch(() => {
      if (current === opening) current = null;
    });
  }
  return current;
}

async function open(): Promise<Broker> {
  const config = brokerConfig();
  const connection = await connect(config.url, { clientProperties: { connection_name: `dystopia-${process.pid}` } });
  const publisher = await connection.createConfirmChannel();
  const broker: Broker = { connection, publisher, declared: new Map(), config };

  // `open()` só roda dentro de `getBroker()`, depois de `current` apontar pra
  // ela: é essa a promessa a esquecer quando ESTA conexão cair.
  const mine = current;
  const forget = () => {
    if (current === mine) current = null;
  };
  connection.on("error", (error: Error) => logger.warn("conexão com o broker deu erro", { error: error.message }));
  connection.on("close", forget);
  publisher.on("error", (error: Error) => logger.warn("canal de publicação deu erro", { error: error.message }));
  // Canal fechado (ex.: declaração com argumento conflitante) leva a conexão
  // junto: mais simples recomeçar do zero do que remendar meio estado.
  publisher.on("close", () => {
    forget();
    connection.close().catch(() => {});
  });

  return broker;
}

/** Fecha a conexão do processo (fim do worker, fim dos testes). */
export async function closeBroker(): Promise<void> {
  const pending = current;
  current = null;
  if (!pending) return;
  try {
    const broker = await pending;
    await broker.connection.close();
  } catch {
    // já estava fechada
  }
}

/** Declara (idempotente) exchanges, fila de trabalho, filas de espera e DLQ. */
export function declareQueue(broker: Broker, queue: string): Promise<void> {
  let declared = broker.declared.get(queue);
  if (!declared) {
    declared = declare(broker.publisher, queue, broker.config);
    broker.declared.set(queue, declared);
    declared.catch(() => broker.declared.delete(queue));
  }
  return declared;
}

async function declare(channel: Channel, queue: string, config: BrokerConfig): Promise<void> {
  const n = names(queue, config);
  await channel.assertExchange(n.exchange, "direct", { durable: true });
  await channel.assertExchange(n.retryExchange, "direct", { durable: true });
  await channel.assertExchange(n.deadExchange, "direct", { durable: true });

  // Mensagem rejeitada sem passar pelo nosso código (nack sem requeue) também
  // cai na DLQ, em vez de sumir.
  await channel.assertQueue(n.work, {
    durable: true,
    arguments: { "x-dead-letter-exchange": n.deadExchange, "x-dead-letter-routing-key": queue },
  });
  await channel.bindQueue(n.work, n.exchange, queue);

  for (const ms of config.retryTiersMs) {
    await channel.assertQueue(n.retry(ms), {
      durable: true,
      arguments: {
        "x-message-ttl": ms,
        "x-dead-letter-exchange": n.exchange,
        "x-dead-letter-routing-key": queue,
      },
    });
    await channel.bindQueue(n.retry(ms), n.retryExchange, n.retryKey(ms));
  }

  await channel.assertQueue(n.dead, { durable: true });
  await channel.bindQueue(n.dead, n.deadExchange, queue);
}

// ---------------------------------------------------------------------------
// Mensagem
// ---------------------------------------------------------------------------

/** Cabeçalhos que a fila controla (o resto do payload é do serviço). */
export const HEADER_ATTEMPTS = "x-attempts";
export const HEADER_MAX_ATTEMPTS = "x-max-attempts";
export const HEADER_ERROR = "x-last-error";
export const HEADER_FAILED_AT = "x-failed-at";

export type Envelope = {
  /** Id da linha da outbox: chave de idempotência da mensagem. */
  id: string;
  queue: string;
  type: string;
  payload: Record<string, unknown>;
  /** Tentativas de processamento JÁ gastas (0 na primeira entrega). */
  attempts: number;
  maxAttempts: number;
  lastError?: string;
};

export type Route =
  | { to: "work" }
  | { to: "retry"; delayMs: number }
  | { to: "dead" };

/**
 * Publica no canal com confirmação. Não espera a confirmação aqui — quem
 * publica em lote chama `waitForConfirms()` uma vez no fim.
 */
export async function publishEnvelope(broker: Broker, envelope: Envelope, route: Route): Promise<void> {
  await declareQueue(broker, envelope.queue);
  const n = names(envelope.queue, broker.config);
  const [exchange, routingKey] =
    route.to === "work"
      ? [n.exchange, envelope.queue]
      : route.to === "retry"
        ? [n.retryExchange, n.retryKey(retryTierFor(route.delayMs, broker.config.retryTiersMs))]
        : [n.deadExchange, envelope.queue];

  broker.publisher.publish(exchange, routingKey, Buffer.from(JSON.stringify(envelope.payload)), {
    messageId: envelope.id,
    type: envelope.type,
    contentType: "application/json",
    persistent: true,
    timestamp: Math.floor(Date.now() / 1_000),
    headers: {
      [HEADER_ATTEMPTS]: envelope.attempts,
      [HEADER_MAX_ATTEMPTS]: envelope.maxAttempts,
      ...(envelope.lastError ? { [HEADER_ERROR]: truncate(envelope.lastError) } : {}),
      ...(route.to === "dead" ? { [HEADER_FAILED_AT]: new Date().toISOString() } : {}),
    },
  });
}

/** Lê uma mensagem crua do broker de volta pro formato da fila. */
export function readEnvelope(
  queue: string,
  message: { content: Buffer; properties: { messageId?: string; type?: string; headers?: Record<string, unknown> } },
): Envelope | null {
  let payload: unknown;
  try {
    payload = JSON.parse(message.content.toString("utf8"));
  } catch {
    return null;
  }
  const { messageId, type, headers = {} } = message.properties;
  if (!messageId || !type || !payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const attempts = Number(headers[HEADER_ATTEMPTS] ?? 0);
  const maxAttempts = Number(headers[HEADER_MAX_ATTEMPTS] ?? 5);
  return {
    id: messageId,
    queue,
    type,
    payload: payload as Record<string, unknown>,
    attempts: Number.isFinite(attempts) ? attempts : 0,
    maxAttempts: Number.isFinite(maxAttempts) && maxAttempts > 0 ? maxAttempts : 5,
    lastError: typeof headers[HEADER_ERROR] === "string" ? (headers[HEADER_ERROR] as string) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Inspeção (painel, testes)
// ---------------------------------------------------------------------------

export type QueueDepth = {
  queue: string;
  ready: number;
  retrying: number;
  /** Menor fila de espera com mensagem: o retry mais próximo volta em até isso. */
  soonestRetryMs: number | null;
  dead: number;
  consumers: number;
};

/** Profundidade de cada fila: pronta, esperando retry e na DLQ. */
export async function queueDepths(queues: string[]): Promise<QueueDepth[]> {
  const broker = await getBroker();
  const depths: QueueDepth[] = [];
  for (const queue of queues) {
    await declareQueue(broker, queue);
    const n = names(queue, broker.config);
    const work = await broker.publisher.checkQueue(n.work);
    let retrying = 0;
    let soonestRetryMs: number | null = null;
    for (const ms of broker.config.retryTiersMs) {
      const count = (await broker.publisher.checkQueue(n.retry(ms))).messageCount;
      retrying += count;
      if (count > 0 && soonestRetryMs === null) soonestRetryMs = ms;
    }
    const dead = await broker.publisher.checkQueue(n.dead);
    depths.push({ queue, ready: work.messageCount, retrying, soonestRetryMs, dead: dead.messageCount, consumers: work.consumerCount });
  }
  return depths;
}

/** Esvazia todas as filas (trabalho, espera e DLQ). Só pra teste. */
export async function purgeQueues(queues: string[]): Promise<void> {
  const broker = await getBroker();
  for (const queue of queues) {
    await declareQueue(broker, queue);
    const n = names(queue, broker.config);
    await broker.publisher.purgeQueue(n.work);
    for (const ms of broker.config.retryTiersMs) await broker.publisher.purgeQueue(n.retry(ms));
    await broker.publisher.purgeQueue(n.dead);
  }
}

function truncate(message: string): string {
  return message.length > 1_000 ? `${message.slice(0, 1_000)}…` : message;
}
