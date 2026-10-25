/**
 * Corpo de `POST /api/assistente`: o histórico da conversa, que vem do
 * navegador — então é palpite. Tamanho por mensagem e de histórico têm teto
 * (cada caractere vira token cobrado na cota do provedor), e só os papéis
 * `user`/`assistant` passam: o cliente nunca escreve instrução de sistema nem
 * resultado de ferramenta.
 */

import { z } from "zod";

export const MAX_MESSAGE_CHARS = 1_000;
/** Turnos enviados ao modelo: o começo de uma conversa longa sai primeiro. */
export const MAX_HISTORY_TURNS = 12;
const MAX_TURNS_ACCEPTED = 40;

const turn = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
});

const schema = z.object({
  messages: z
    .array(turn)
    .min(1)
    .max(MAX_TURNS_ACCEPTED)
    .refine((messages) => messages.at(-1)?.role === "user"),
});

export type AssistantRequest = { history: z.output<typeof turn>[] };

export function parseAssistantRequest(body: unknown): { ok: true; value: AssistantRequest } | { ok: false; error: string } {
  const result = schema.safeParse(body);
  // A tela nunca monta um corpo inválido: quem chega aqui é chamada à mão, e
  // o detalhe do esquema não ajuda ninguém.
  if (!result.success) return { ok: false, error: "Pedido inválido." };
  let history = result.data.messages.slice(-MAX_HISTORY_TURNS);
  // O modelo precisa começar por uma fala da pessoa, não pela metade de uma troca.
  while (history.length > 1 && history[0].role !== "user") history = history.slice(1);
  return { ok: true, value: { history } };
}
