import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AssistantBusyError,
  AssistantUnavailableError,
  chatConfigFromEnv,
  createChatCompletion,
  DEFAULT_CHAT_API_URL,
  DEFAULT_CHAT_MODEL,
} from "@/lib/assistant/provider";

const config = { url: "https://llm.exemplo/v1", apiKey: "chave-teste", model: "modelo-x" };

/** `fetch` falso que grava a chamada e responde o que o caso mandar. */
function fakeFetch(respond: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

describe("configuração do assistente", () => {
  it("sem chave, o assistente não existe", () => {
    assert.equal(chatConfigFromEnv({}), null);
    assert.equal(chatConfigFromEnv({ CHAT_API_KEY: "  " }), null);
  });

  it("com chave, usa Groq e o modelo padrão — e aceita trocar os dois", () => {
    assert.deepEqual(chatConfigFromEnv({ CHAT_API_KEY: "k" }), {
      url: DEFAULT_CHAT_API_URL,
      apiKey: "k",
      model: DEFAULT_CHAT_MODEL,
    });
    assert.deepEqual(
      chatConfigFromEnv({ CHAT_API_KEY: "k", CHAT_API_URL: "https://ai-gateway.vercel.sh/v1/", CHAT_MODEL: "x/y" }),
      { url: "https://ai-gateway.vercel.sh/v1", apiKey: "k", model: "x/y" },
    );
  });
});

describe("chamada ao provedor", () => {
  it("manda modelo, mensagens, ferramentas e a chave no padrão Chat Completions", async () => {
    const { impl, calls } = fakeFetch(() => json({ choices: [{ message: { content: "Olá." } }] }));
    const tools = [{ type: "function" as const, function: { name: "f", description: "d", parameters: {} } }];
    const reply = await createChatCompletion(config, impl)([{ role: "user", content: "oi" }], tools);

    assert.deepEqual(reply, { content: "Olá.", toolCalls: [] });
    assert.equal(calls[0].url, "https://llm.exemplo/v1/chat/completions");
    assert.equal((calls[0].init.headers as Record<string, string>).authorization, "Bearer chave-teste");
    const body = JSON.parse(String(calls[0].init.body));
    assert.equal(body.model, "modelo-x");
    assert.deepEqual(body.messages, [{ role: "user", content: "oi" }]);
    assert.deepEqual(body.tools, tools);
  });

  it("devolve as ferramentas que o modelo pediu", async () => {
    const toolCalls = [{ id: "c1", type: "function", function: { name: "buscar_produtos", arguments: '{"termo":"ssd"}' } }];
    const { impl } = fakeFetch(() => json({ choices: [{ message: { content: null, tool_calls: toolCalls } }] }));
    const reply = await createChatCompletion(config, impl)([{ role: "user", content: "ssd?" }], []);
    assert.deepEqual(reply, { content: null, toolCalls });
  });

  it("limite do provedor (429) vira ocupado, com o tempo de espera que ele mandou", async () => {
    const { impl } = fakeFetch(() => new Response("{}", { status: 429, headers: { "retry-after": "7" } }));
    await assert.rejects(
      createChatCompletion(config, impl)([{ role: "user", content: "oi" }], []),
      (error: unknown) => error instanceof AssistantBusyError && error.retryAfterSeconds === 7,
    );
  });

  it("429 sem retry-after espera um padrão em vez de zero", async () => {
    const { impl } = fakeFetch(() => new Response("{}", { status: 429 }));
    await assert.rejects(
      createChatCompletion(config, impl)([{ role: "user", content: "oi" }], []),
      (error: unknown) => error instanceof AssistantBusyError && error.retryAfterSeconds === 30,
    );
  });

  it("erro do provedor, rede caída ou resposta sem mensagem viram indisponível", async () => {
    const cases: (() => Response)[] = [
      () => new Response("chave inválida", { status: 401 }),
      () => json({ choices: [] }),
      () => {
        throw new TypeError("fetch failed");
      },
    ];
    for (const respond of cases) {
      const { impl } = fakeFetch(respond);
      await assert.rejects(
        createChatCompletion(config, impl)([{ role: "user", content: "oi" }], []),
        AssistantUnavailableError,
      );
    }
  });
});
