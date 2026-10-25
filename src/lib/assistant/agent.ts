/**
 * Uma volta da conversa: manda o histórico para o modelo, executa as
 * ferramentas que ele pedir e devolve o texto final.
 *
 * O laço tem teto (`MAX_TOOL_ROUNDS`): modelo que pede ferramenta sem parar
 * não segura o request nem gasta a cota do provedor. No teto, a última
 * chamada vai sem ferramentas — o modelo é obrigado a responder com o que já
 * tem.
 */

import type { ChatMessage, CompleteChat, ChatTool } from "./provider";

export const MAX_TOOL_ROUNDS = 4;
/** Resultado de ferramenta grande estoura a cota de tokens por minuto. */
const MAX_TOOL_RESULT_CHARS = 3_000;
const EMPTY_REPLY = "Não consegui formular uma resposta. Tente perguntar de outro jeito.";

export type ConversationTurn = { role: "user" | "assistant"; content: string };

export type RunTool = (name: string, rawArguments: string) => Promise<Record<string, unknown>>;

export async function answer(input: {
  systemPrompt: string;
  history: ConversationTurn[];
  tools: ChatTool[];
  complete: CompleteChat;
  runTool: RunTool;
}): Promise<{ reply: string; toolsUsed: string[] }> {
  const messages: ChatMessage[] = [{ role: "system", content: input.systemPrompt }, ...input.history];
  const toolsUsed: string[] = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const lastRound = round === MAX_TOOL_ROUNDS;
    const reply = await input.complete(messages, lastRound ? [] : input.tools);
    if (reply.toolCalls.length === 0 || lastRound) {
      return { reply: reply.content?.trim() || EMPTY_REPLY, toolsUsed };
    }

    messages.push({ role: "assistant", content: reply.content, tool_calls: reply.toolCalls });
    // Em sequência, não em paralelo: são poucas e baratas, e a ordem do log
    // fica igual à que o modelo pediu.
    for (const call of reply.toolCalls) {
      toolsUsed.push(call.function.name);
      const result = await input.runTool(call.function.name, call.function.arguments);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(result).slice(0, MAX_TOOL_RESULT_CHARS),
      });
    }
  }
  // Inalcançável: a volta do teto sempre retorna.
  return { reply: EMPTY_REPLY, toolsUsed };
}
