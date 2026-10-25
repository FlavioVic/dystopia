/**
 * Cliente do modelo de linguagem do assistente — protocolo Chat Completions
 * (o padrão que Groq, AI Gateway, OpenAI e Gemini aceitam), chamado via
 * `fetch`, sem SDK, como o Stripe. Trocar de provedor é trocar três
 * variáveis: `CHAT_API_URL`, `CHAT_API_KEY`, `CHAT_MODEL`.
 */

export const DEFAULT_CHAT_API_URL = "https://api.groq.com/openai/v1";
export const DEFAULT_CHAT_MODEL = "llama-3.3-70b-versatile";
const TIMEOUT_MS = 20_000;

export type ChatToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; name: string; content: string };

export type ChatTool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ChatConfig = { url: string; apiKey: string; model: string };

/** O que o assistente faz com uma resposta do modelo: texto final ou ferramentas a chamar. */
export type ChatReply = { content: string | null; toolCalls: ChatToolCall[] };

export type CompleteChat = (messages: ChatMessage[], tools: ChatTool[]) => Promise<ChatReply>;

/** Provedor no limite (429): a pessoa tenta de novo em instantes. */
export class AssistantBusyError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("assistente ocupado");
    this.name = "AssistantBusyError";
  }
}

/** Qualquer outra falha do provedor (fora do ar, chave inválida, resposta estranha). */
export class AssistantUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantUnavailableError";
  }
}

/** Sem `CHAT_API_KEY` o assistente não existe: o site não mostra o botão. */
export function chatConfigFromEnv(env: Record<string, string | undefined> = process.env): ChatConfig | null {
  const apiKey = env.CHAT_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    url: (env.CHAT_API_URL?.trim() || DEFAULT_CHAT_API_URL).replace(/\/+$/, ""),
    apiKey,
    model: env.CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL,
  };
}

export function createChatCompletion(config: ChatConfig, fetchImpl: typeof fetch = fetch): CompleteChat {
  return async (messages, tools) => {
    let response: Response;
    try {
      response = await fetchImpl(`${config.url}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          messages,
          tools,
          // Respostas de balcão: curtas e sem criatividade para inventar produto.
          temperature: 0.2,
          max_tokens: 600,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new AssistantUnavailableError(`sem resposta do provedor: ${(error as Error).message}`);
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new AssistantBusyError(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 30);
    }
    if (!response.ok) {
      // O corpo pode ecoar detalhes da conta: vai só para o log do servidor, nunca para o cliente.
      throw new AssistantUnavailableError(`provedor respondeu ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }

    const body = (await response.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: ChatToolCall[] } }[];
    };
    const message = body.choices?.[0]?.message;
    if (!message) throw new AssistantUnavailableError("resposta sem `choices[0].message`");
    return { content: message.content ?? null, toolCalls: message.tool_calls ?? [] };
  };
}
