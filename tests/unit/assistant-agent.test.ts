import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { answer, MAX_TOOL_ROUNDS } from "@/lib/assistant/agent";
import { buildSystemPrompt } from "@/lib/assistant/prompt";
import type { ChatMessage, ChatReply, ChatTool } from "@/lib/assistant/provider";
import { CONTACT_EMAIL } from "@/lib/site";

const tools: ChatTool[] = [{ type: "function", function: { name: "buscar_produtos", description: "d", parameters: {} } }];

/** Modelo falso: responde a fila de respostas e grava o que recebeu. */
function scriptedModel(replies: ChatReply[]) {
  const seen: { messages: ChatMessage[]; tools: ChatTool[] }[] = [];
  const complete = async (messages: ChatMessage[], offered: ChatTool[]) => {
    seen.push({ messages: structuredClone(messages), tools: offered });
    const next = replies.shift();
    if (!next) throw new Error("modelo chamado mais vezes que o roteiro");
    return next;
  };
  return { complete, seen };
}

const toolCall = (id: string, args: string) => ({
  id,
  type: "function" as const,
  function: { name: "buscar_produtos", arguments: args },
});

describe("laço do assistente", () => {
  it("sem ferramenta: devolve o texto do modelo", async () => {
    const model = scriptedModel([{ content: "  Olá.  ", toolCalls: [] }]);
    const result = await answer({
      systemPrompt: "instruções",
      history: [{ role: "user", content: "oi" }],
      tools,
      complete: model.complete,
      runTool: async () => ({}),
    });
    assert.deepEqual(result, { reply: "Olá.", toolsUsed: [] });
    assert.deepEqual(model.seen[0].messages, [
      { role: "system", content: "instruções" },
      { role: "user", content: "oi" },
    ]);
  });

  it("executa a ferramenta pedida e devolve o resultado ao modelo, ligado ao id da chamada", async () => {
    const model = scriptedModel([
      { content: null, toolCalls: [toolCall("c1", '{"termo":"ssd"}')] },
      { content: "Temos o [SSD](/produto/ssd).", toolCalls: [] },
    ]);
    const calls: [string, string][] = [];
    const result = await answer({
      systemPrompt: "s",
      history: [{ role: "user", content: "tem ssd?" }],
      tools,
      complete: model.complete,
      runTool: async (name, args) => {
        calls.push([name, args]);
        return { produtos: [{ nome: "SSD" }] };
      },
    });

    assert.deepEqual(calls, [["buscar_produtos", '{"termo":"ssd"}']]);
    assert.deepEqual(result, { reply: "Temos o [SSD](/produto/ssd).", toolsUsed: ["buscar_produtos"] });
    const second = model.seen[1].messages;
    assert.equal(second.at(-2)?.role, "assistant");
    assert.deepEqual(second.at(-1), {
      role: "tool",
      tool_call_id: "c1",
      name: "buscar_produtos",
      content: JSON.stringify({ produtos: [{ nome: "SSD" }] }),
    });
  });

  it("modelo que pede ferramenta sem parar é cortado no teto e obrigado a responder", async () => {
    const loop = Array.from({ length: MAX_TOOL_ROUNDS }, (_, i) => ({ content: null, toolCalls: [toolCall(`c${i}`, "{}")] }));
    const model = scriptedModel([...loop, { content: "Encerrado.", toolCalls: [toolCall("extra", "{}")] }]);
    let executed = 0;
    const result = await answer({
      systemPrompt: "s",
      history: [{ role: "user", content: "x" }],
      tools,
      complete: model.complete,
      runTool: async () => {
        executed += 1;
        return {};
      },
    });

    assert.equal(executed, MAX_TOOL_ROUNDS, "a chamada pedida na volta do teto não roda");
    assert.equal(result.reply, "Encerrado.");
    assert.deepEqual(model.seen.at(-1)?.tools, [], "a última chamada vai sem ferramentas");
  });

  it("resultado gigante de ferramenta é cortado antes de voltar ao modelo", async () => {
    const model = scriptedModel([
      { content: null, toolCalls: [toolCall("c1", "{}")] },
      { content: "ok", toolCalls: [] },
    ]);
    await answer({
      systemPrompt: "s",
      history: [{ role: "user", content: "x" }],
      tools,
      complete: model.complete,
      runTool: async () => ({ texto: "a".repeat(10_000) }),
    });
    const toolMessage = model.seen[1].messages.at(-1) as { content: string };
    assert.ok(toolMessage.content.length <= 3_000);
  });

  it("resposta vazia vira uma frase útil, não um balão em branco", async () => {
    const model = scriptedModel([{ content: "   ", toolCalls: [] }]);
    const result = await answer({ systemPrompt: "s", history: [{ role: "user", content: "x" }], tools, complete: model.complete, runTool: async () => ({}) });
    assert.match(result.reply, /Tente perguntar de outro jeito/);
  });
});

describe("instruções do assistente", () => {
  const facts = { loggedIn: false, categories: "Processadores (processadores)", coupons: ["BEMVINDO10: 10%"] };

  it("usam os fatos da loja e as categorias reais", () => {
    const prompt = buildSystemPrompt(facts);
    assert.match(prompt, /grátis a partir de R\$\s149,90/);
    assert.match(prompt, /BEMVINDO10/);
    assert.match(prompt, /Processadores \(processadores\)/);
    assert.match(prompt, /Montagem de computadores \(montagem\)/);
    assert.ok(prompt.includes(CONTACT_EMAIL), "contato da loja para o que o assistente não resolve");
  });

  it("dizem se a pessoa está logada — é o que decide se ela pode pedir pedidos", () => {
    assert.match(buildSystemPrompt(facts), /NÃO está logada/);
    assert.match(buildSystemPrompt({ ...facts, loggedIn: true }), /está logada; use meus_pedidos/);
  });

  it("cabem no orçamento de tokens do plano grátis (≈ 4 caracteres por token)", () => {
    assert.ok(buildSystemPrompt(facts).length < 4_000);
  });
});
