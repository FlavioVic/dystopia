/**
 * `POST /api/assistente` de ponta a ponta, menos o modelo: origem, validação,
 * limite por IP no Postgres, instruções montadas com dado real, ferramenta
 * executada contra o banco e erro do provedor virando resposta legível.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { db } from "@/db";
import { categories, coupons, products } from "@/db/schema";
import { handleAssistantMessage } from "@/lib/assistant/handler";
import {
  AssistantBusyError,
  AssistantUnavailableError,
  type ChatMessage,
  type ChatReply,
  type CompleteChat,
} from "@/lib/assistant/provider";
import { closeDatabase, resetDatabase } from "../helpers/db";

beforeEach(resetDatabase);
after(closeDatabase);

const sameOrigin = new Headers({ origin: "https://loja.dev", host: "loja.dev" });
const body = { messages: [{ role: "user", content: "tem ryzen?" }] };
const visitor = { userId: null, ip: "198.51.100.7" };

function model(replies: ChatReply[]) {
  const seen: ChatMessage[][] = [];
  const complete: CompleteChat = async (messages) => {
    seen.push(structuredClone(messages));
    return replies.shift() ?? { content: "fim", toolCalls: [] };
  };
  return { complete, seen };
}

const failing = (error: Error): CompleteChat => async () => {
  throw error;
};

describe("assistente — porta de entrada", () => {
  it("pergunta → ferramenta no banco → resposta com o produto real", async () => {
    const [category] = await db.insert(categories).values({ name: "Processadores", slug: "processadores" }).returning();
    await db.insert(products).values({
      categoryId: category.id, name: "Processador Ryzen 5 9600X", slug: "ryzen-5", sku: "CPU-1",
      description: "x", priceCents: 169_990, stockQuantity: 3,
    });
    await db.insert(coupons).values({
      code: "BEMVINDO10", discountType: "percentage", discountValue: 10, minOrderCents: 5_000, validFrom: new Date(Date.now() - 1_000),
    });
    const fake = model([
      { content: null, toolCalls: [{ id: "c1", type: "function", function: { name: "buscar_produtos", arguments: '{"termo":"ryzen"}' } }] },
      { content: "Temos o [Ryzen 5 9600X](/produto/ryzen-5).", toolCalls: [] },
    ]);

    const response = await handleAssistantMessage({ headers: sameOrigin, body, context: visitor, complete: fake.complete });

    assert.deepEqual(response, { status: 200, body: { reply: "Temos o [Ryzen 5 9600X](/produto/ryzen-5)." } });
    const system = fake.seen[0][0].content as string;
    assert.match(system, /Processadores \(processadores\)/, "categorias reais nas instruções");
    assert.match(system, /BEMVINDO10: 10% acima de R\$\s50,00/, "cupom ativo nas instruções");
    assert.match(system, /NÃO está logada/);
    const toolResult = fake.seen[1].at(-1) as { role: string; content: string };
    assert.equal(toolResult.role, "tool");
    assert.match(toolResult.content, /\/produto\/ryzen-5/);
  });

  it("chamada de outro site é recusada antes de tudo", async () => {
    const fake = model([]);
    const response = await handleAssistantMessage({
      headers: new Headers({ origin: "https://golpe.dev", host: "loja.dev" }),
      body,
      context: visitor,
      complete: fake.complete,
    });
    assert.equal(response.status, 403);
    assert.equal(fake.seen.length, 0, "o modelo nem é chamado");
  });

  it("corpo inválido é 400, sem gastar o limite nem o modelo", async () => {
    const fake = model([]);
    const response = await handleAssistantMessage({ headers: sameOrigin, body: { messages: [] }, context: visitor, complete: fake.complete });
    assert.equal(response.status, 400);
    assert.equal(fake.seen.length, 0);
  });

  it("limite por IP: passou do teto, 429 sem chamar o modelo", async () => {
    const fake = model([]);
    const ip = "198.51.100.99";
    for (let i = 0; i < 20; i += 1) {
      const ok = await handleAssistantMessage({ headers: sameOrigin, body, context: { userId: null, ip }, complete: fake.complete });
      assert.equal(ok.status, 200);
    }
    const calls = fake.seen.length;
    const blocked = await handleAssistantMessage({ headers: sameOrigin, body, context: { userId: null, ip }, complete: fake.complete });
    assert.equal(blocked.status, 429);
    assert.match((blocked.body as { error: string }).error, /Limite de mensagens/);
    assert.equal(fake.seen.length, calls);
    // Outro IP segue normal.
    assert.equal((await handleAssistantMessage({ headers: sameOrigin, body, context: visitor, complete: fake.complete })).status, 200);
  });

  it("provedor no limite vira 503 com o tempo de espera; fora do ar, 503 sem detalhe interno", async () => {
    const busy = await handleAssistantMessage({ headers: sameOrigin, body, context: visitor, complete: failing(new AssistantBusyError(12)) });
    assert.deepEqual(busy, { status: 503, body: { error: "Muitas perguntas ao mesmo tempo. Tente de novo em 12 s." } });

    const down = await handleAssistantMessage({
      headers: sameOrigin,
      body,
      context: visitor,
      complete: failing(new AssistantUnavailableError("provedor respondeu 401: chave sk-secreta inválida")),
    });
    assert.deepEqual(down, { status: 503, body: { error: "Assistente indisponível no momento." } });
    assert.ok(!JSON.stringify(down).includes("sk-secreta"));
  });

  it("pessoa logada: as instruções liberam as ferramentas de pedido", async () => {
    const fake = model([{ content: "ok", toolCalls: [] }]);
    await handleAssistantMessage({ headers: sameOrigin, body, context: { userId: "00000000-0000-0000-0000-000000000001", ip: "x" }, complete: fake.complete });
    assert.match(fake.seen[0][0].content as string, /está logada; use meus_pedidos/);
  });
});
