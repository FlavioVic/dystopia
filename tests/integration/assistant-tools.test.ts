/**
 * Ferramentas do assistente contra o banco real. O que importa aqui é a
 * fronteira: o modelo escolhe argumentos, mas quem a pessoa é vem do servidor
 * — pedido de outra conta nunca aparece, visitante não vê pedido nenhum.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, products, serviceRequests } from "@/db/schema";
import { type AssistantContext, runTool } from "@/lib/assistant/tools";
import { formatPriceCents } from "@/lib/format";
import { startCheckout } from "../helpers/checkout";
import { closeDatabase, resetDatabase, seedCheckoutFixture } from "../helpers/db";

beforeEach(resetDatabase);
after(closeDatabase);

const visitor: AssistantContext = { userId: null, ip: "203.0.113.10" };
const call = (name: string, args: unknown, context: AssistantContext = visitor) =>
  runTool(name, JSON.stringify(args), context);

async function seedCatalog() {
  const [gpus] = await db.insert(categories).values({ name: "Placas de vídeo", slug: "placas-de-video" }).returning();
  const [cpus] = await db.insert(categories).values({ name: "Processadores", slug: "processadores" }).returning();
  const base = { description: "x", stockQuantity: 5 };
  await db.insert(products).values([
    { ...base, categoryId: gpus.id, name: "Placa de vídeo RTX 5060", slug: "rtx-5060", sku: "GPU-1", brand: "NVIDIA", priceCents: 249_990 },
    { ...base, categoryId: gpus.id, name: "Placa de vídeo RTX 5070", slug: "rtx-5070", sku: "GPU-2", brand: "NVIDIA", priceCents: 459_990 },
    { ...base, categoryId: gpus.id, name: "Placa de vídeo RTX 5050", slug: "rtx-5050", sku: "GPU-3", brand: "NVIDIA", priceCents: 179_990, stockQuantity: 0 },
    { ...base, categoryId: cpus.id, name: "Processador Ryzen 5 9600X", slug: "ryzen-5", sku: "CPU-1", brand: "AMD", priceCents: 169_990 },
    { ...base, categoryId: cpus.id, name: "Processador RTX inativo", slug: "inativo", sku: "CPU-2", priceCents: 1_000, isActive: false },
  ]);
}

describe("buscar_produtos", () => {
  it("acha pelo termo e devolve preço formatado e link da loja", async () => {
    await seedCatalog();
    const result = await call("buscar_produtos", { termo: "ryzen" });
    assert.deepEqual(result.produtos, [
      { nome: "Processador Ryzen 5 9600X", marca: "AMD", categoria: "Processadores", preco: formatPriceCents(169_990), em_estoque: true, link: "/produto/ryzen-5" },
    ]);
  });

  it("\"até R$ 3.000\" vai para o banco: o teto de preço filtra", async () => {
    await seedCatalog();
    const { produtos } = (await call("buscar_produtos", { termo: "rtx", preco_max_reais: 3000 })) as { produtos: { link: string }[] };
    assert.deepEqual(produtos.map((p) => p.link).sort(), ["/produto/rtx-5050", "/produto/rtx-5060"]);
  });

  it("com estoque vem antes do esgotado; produto inativo nunca aparece", async () => {
    await seedCatalog();
    const { produtos } = (await call("buscar_produtos", { termo: "rtx" })) as { produtos: { link: string; em_estoque: boolean }[] };
    assert.equal(produtos.at(-1)?.link, "/produto/rtx-5050");
    assert.equal(produtos.at(-1)?.em_estoque, false);
    assert.ok(!produtos.some((p) => p.link === "/produto/inativo"));
  });

  it("filtra só pela categoria", async () => {
    await seedCatalog();
    const { produtos } = (await call("buscar_produtos", { categoria: "processadores" })) as { produtos: unknown[] };
    assert.equal(produtos.length, 1);
  });

  it("sem filtro nenhum, ou categoria que não existe, não varre o catálogo", async () => {
    await seedCatalog();
    assert.equal((await call("buscar_produtos", {})).erro, "sem_filtro");
    const unknown = await call("buscar_produtos", { categoria: "nao-existe" });
    assert.deepEqual(unknown.produtos, []);
    assert.ok(unknown.instrucao);
  });

  it("entrada hostil não chega ao banco como operador de busca", async () => {
    await seedCatalog();
    const result = await call("buscar_produtos", { termo: "rtx & !ryzen | (" });
    assert.ok(Array.isArray(result.produtos));
  });
});

describe("pedidos", () => {
  it("visitante é mandado entrar na conta, sem consulta nenhuma", async () => {
    assert.equal((await call("meus_pedidos", {})).erro, "nao_logado");
    assert.equal((await call("ver_pedido", { numero: "DYS-2026-000001" })).erro, "nao_logado");
  });

  it("lista só os pedidos da própria conta", async () => {
    const mine = await seedCheckoutFixture();
    const other = await seedCheckoutFixture();
    const myOrder = await startCheckout(mine);
    await startCheckout(other);

    const { pedidos } = (await call("meus_pedidos", {}, { userId: mine.userId, ip: "x" })) as { pedidos: { numero: string; status: string; link: string }[] };
    assert.deepEqual(pedidos.map((p) => p.numero), [myOrder.orderNumber]);
    assert.equal(pedidos[0].status, "Pendente");
    assert.equal(pedidos[0].link, `/pedido/${myOrder.orderNumber}`);
  });

  it("detalha o próprio pedido (aceita número em minúsculas)", async () => {
    const mine = await seedCheckoutFixture({ quantity: 2 });
    const order = await startCheckout(mine);
    const result = await call("ver_pedido", { numero: order.orderNumber.toLowerCase() }, { userId: mine.userId, ip: "x" });
    assert.equal(result.numero, order.orderNumber);
    assert.deepEqual(result.itens, ["2× Produto de teste"]);
    assert.ok(String(result.total).startsWith("R$"));
  });

  it("pedido de outra conta é \"não encontrado\" — mesmo com o número certo", async () => {
    const owner = await seedCheckoutFixture();
    const intruder = await seedCheckoutFixture();
    const order = await startCheckout(owner);
    const result = await call("ver_pedido", { numero: order.orderNumber }, { userId: intruder.userId, ip: "x" });
    assert.equal(result.erro, "nao_encontrado");
    assert.ok(!JSON.stringify(result).includes(order.orderNumber));
  });
});

describe("registrar_orcamento", () => {
  const request = {
    servico: "montagem",
    nome: "Ana Souza",
    email: "ana@exemplo.com",
    descricao: "Montar um PC com RTX 5070 e Ryzen 7 9800X3D.",
  };

  it("registra com protocolo, ligado à conta quando há login", async () => {
    const fixture = await seedCheckoutFixture();
    const result = await call("registrar_orcamento", request, { userId: fixture.userId, ip: "x" });
    assert.match(String(result.protocolo), /^DYS-S\d{6}$/);
    const [row] = await db.select().from(serviceRequests).where(eq(serviceRequests.protocol, String(result.protocolo)));
    assert.equal(row.kind, "montagem");
    assert.equal(row.userId, fixture.userId);
  });

  it("passa pela mesma validação do formulário", async () => {
    const result = await call("registrar_orcamento", { ...request, email: "ana@", descricao: "pc lento" });
    assert.equal(result.erro, "dados_invalidos");
    assert.ok((result.campos as Record<string, string>).email);
    assert.ok((result.campos as Record<string, string>).details);
    assert.equal((await db.select().from(serviceRequests)).length, 0);
  });

  it("serviço fora do catálogo é recusado", async () => {
    const result = await call("registrar_orcamento", { ...request, servico: "hackear" });
    assert.equal(result.erro, "dados_invalidos");
  });

  it("divide o limite por IP com o formulário: o chat não é porta lateral", async () => {
    const ip = "203.0.113.99";
    for (let i = 0; i < 5; i += 1) {
      assert.ok((await call("registrar_orcamento", request, { userId: null, ip })).protocolo);
    }
    assert.equal((await call("registrar_orcamento", request, { userId: null, ip })).erro, "limite");
    assert.equal((await db.select().from(serviceRequests)).length, 5);
  });
});

describe("erros do modelo viram resultado, não exceção", () => {
  it("ferramenta inexistente, JSON quebrado e argumento fora do esquema", async () => {
    assert.equal((await runTool("apagar_tudo", "{}", visitor)).erro, "ferramenta_inexistente");
    assert.equal((await runTool("buscar_produtos", "{termo:", visitor)).erro, "argumentos_invalidos");
    assert.equal((await call("buscar_produtos", { preco_max_reais: -5 })).erro, "argumentos_invalidos");
  });
});
