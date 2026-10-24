/**
 * Operação da DLQ (parking lot): olhar o que caiu lá e reprocessar.
 *
 * Mensagem só cai na DLQ quando retry não resolveu (tentativas esgotadas) ou
 * não resolveria (erro permanente, mensagem ilegível, tipo sem handler).
 * Reprocessar é decisão de gente: depois de corrigir a causa, a mensagem
 * volta pra fila de trabalho com as tentativas zeradas.
 */

import { declareQueue, getBroker, names, publishEnvelope, readEnvelope, HEADER_ERROR, HEADER_FAILED_AT } from "./broker";

export type DeadLetter = {
  id: string;
  queue: string;
  type: string;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  failedAt: string | null;
  payload: Record<string, unknown>;
};

/**
 * Lista sem consumir: pega até `limit` mensagens e devolve todas com `nack`
 * + requeue ao fechar o canal. Pra painel, com DLQ pequena — não é pra lote.
 */
export async function peekDeadLetters(queue: string, limit = 20): Promise<DeadLetter[]> {
  const broker = await getBroker();
  await declareQueue(broker, queue);
  const channel = await broker.connection.createChannel();
  const letters: DeadLetter[] = [];
  try {
    for (let i = 0; i < limit; i += 1) {
      const raw = await channel.get(names(queue, broker.config).dead, { noAck: false });
      if (!raw) break;
      const envelope = readEnvelope(queue, raw);
      const headers = raw.properties.headers ?? {};
      letters.push({
        id: envelope?.id ?? raw.properties.messageId ?? "(sem id)",
        queue,
        type: envelope?.type ?? raw.properties.type ?? "(ilegível)",
        attempts: envelope?.attempts ?? 0,
        maxAttempts: envelope?.maxAttempts ?? 0,
        error: typeof headers[HEADER_ERROR] === "string" ? (headers[HEADER_ERROR] as string) : null,
        failedAt: typeof headers[HEADER_FAILED_AT] === "string" ? (headers[HEADER_FAILED_AT] as string) : null,
        payload: envelope?.payload ?? {},
      });
    }
    channel.nackAll(true);
  } finally {
    await channel.close().catch(() => {});
  }
  return letters;
}

/**
 * Devolve mensagens da DLQ pra fila de trabalho, tentativas zeradas. Com
 * `messageId`, só aquela (as outras voltam pra DLQ intactas). Retorna quantas
 * foram reprocessadas.
 */
export async function replayDeadLetters(queue: string, options: { messageId?: string; limit?: number } = {}): Promise<number> {
  const broker = await getBroker();
  await declareQueue(broker, queue);
  const channel = await broker.connection.createChannel();
  let replayed = 0;
  try {
    for (let i = 0; i < (options.limit ?? 500); i += 1) {
      const raw = await channel.get(names(queue, broker.config).dead, { noAck: false });
      if (!raw) break;
      const envelope = readEnvelope(queue, raw);
      // Não é a pedida: fica sem ack (não volta pra este canal) e é devolvida
      // no fim. `nack` agora a poria na cabeça da fila e o próximo `get`
      // pegaria ela de novo.
      if (!envelope || (options.messageId && envelope.id !== options.messageId)) continue;
      // Publica (com confirmação) ANTES do ack: se cair no meio, a mensagem
      // continua na DLQ e no máximo aparece duas vezes — nunca some.
      await publishEnvelope(broker, { ...envelope, attempts: 0, lastError: undefined }, { to: "work" });
      await broker.publisher.waitForConfirms();
      channel.ack(raw);
      replayed += 1;
      if (options.messageId) break;
    }
    channel.nackAll(true);
  } finally {
    await channel.close().catch(() => {});
  }
  return replayed;
}
