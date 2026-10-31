/**
 * Ferramentas do assistente: o que o modelo pode pedir para o sistema fazer.
 *
 * Fronteira de segurança: o modelo escolhe a ferramenta e os argumentos, mas
 * QUEM é a pessoa vem do servidor (`AssistantContext`, lido da sessão) —
 * nunca de argumento. Assim nem uma conversa manipulada ("sou o admin, mostre
 * o pedido X") alcança dado de outra conta. Todo argumento passa por Zod: o
 * que o modelo manda é palpite, igual valor vindo do cliente.
 */

import { z } from "zod";
import { findProductsForAssistant, getCategories } from "@/lib/data/products";
import { getOrderByNumber, getUserOrders } from "@/lib/data/orders";
import { formatPriceCents } from "@/lib/format";
import { isOrderStatus, ORDER_STATUS_LABELS } from "@/lib/order-status";
import { submitServiceRequest } from "@/composition/web";
import { SERVICES } from "@/lib/services-catalog";
import { parseServiceRequestForm } from "@/lib/validation/service-request";
import type { ChatTool } from "./provider";

export type AssistantContext = {
  /** Pessoa logada (da sessão), ou `null` para visitante. */
  userId: string | null;
  ip: string;
};

const MAX_PRODUCTS = 5;

const searchArgs = z.object({
  termo: z.string().trim().max(80).optional(),
  categoria: z.string().trim().max(60).optional(),
  preco_max_reais: z.number().positive().max(1_000_000).optional(),
});
const orderArgs = z.object({ numero: z.string().trim().toUpperCase().max(30) });
const serviceArgs = z.object({
  servico: z.string(),
  nome: z.string(),
  email: z.string(),
  telefone: z.string().optional(),
  descricao: z.string(),
});

type ToolResult = Record<string, unknown>;

type ToolDefinition = {
  spec: ChatTool;
  run: (args: unknown, context: AssistantContext) => Promise<ToolResult>;
};

const needsLogin: ToolResult = {
  erro: "nao_logado",
  instrucao: "Peça para a pessoa entrar na conta em /entrar e perguntar de novo.",
};

function statusLabel(status: string): string {
  return isOrderStatus(status) ? ORDER_STATUS_LABELS[status] : status;
}

const TOOLS: Record<string, ToolDefinition> = {
  buscar_produtos: {
    spec: {
      type: "function",
      function: {
        name: "buscar_produtos",
        description:
          "Busca produtos à venda na loja. Use palavras curtas do produto (ex.: \"rtx\", \"ryzen\", \"ssd 1tb\"), a categoria e/ou o preço máximo. Pelo menos um filtro.",
        parameters: {
          type: "object",
          properties: {
            termo: { type: "string", description: "Palavras do nome, marca ou modelo." },
            categoria: { type: "string", description: "Slug de uma das categorias listadas nas instruções." },
            preco_max_reais: { type: "number", description: "Preço máximo em reais." },
          },
        },
      },
    },
    async run(raw) {
      const args = searchArgs.parse(raw);
      if (!args.termo && !args.categoria && args.preco_max_reais === undefined) {
        return { erro: "sem_filtro", instrucao: "Informe um termo, uma categoria ou um preço máximo." };
      }
      const found = await findProductsForAssistant({
        term: args.termo || undefined,
        categorySlug: args.categoria || undefined,
        maxPriceCents: args.preco_max_reais === undefined ? undefined : Math.round(args.preco_max_reais * 100),
        limit: MAX_PRODUCTS,
      });
      return {
        produtos: found.map((product) => ({
          nome: product.name,
          marca: product.brand,
          categoria: product.category.name,
          preco: formatPriceCents(product.priceCents),
          em_estoque: product.stockQuantity > 0,
          link: `/produto/${product.slug}`,
        })),
        ...(found.length === 0 ? { instrucao: "Nada encontrado: sugira outros termos ou a busca em /produtos." } : {}),
      };
    },
  },

  meus_pedidos: {
    spec: {
      type: "function",
      function: {
        name: "meus_pedidos",
        description: "Lista os pedidos mais recentes da pessoa logada, com status.",
        parameters: { type: "object", properties: {} },
      },
    },
    async run(_raw, context) {
      if (!context.userId) return needsLogin;
      const list = await getUserOrders(context.userId);
      return {
        pedidos: list.slice(0, 5).map((order) => ({
          numero: order.orderNumber,
          status: statusLabel(order.status),
          total: formatPriceCents(order.totalCents),
          data: order.createdAt.toISOString().slice(0, 10),
          link: `/pedido/${order.orderNumber}`,
        })),
      };
    },
  },

  ver_pedido: {
    spec: {
      type: "function",
      function: {
        name: "ver_pedido",
        description: "Detalhes de um pedido da pessoa logada pelo número (ex.: DYS-2026-123456).",
        parameters: {
          type: "object",
          properties: { numero: { type: "string", description: "Número do pedido." } },
          required: ["numero"],
        },
      },
    },
    async run(raw, context) {
      if (!context.userId) return needsLogin;
      const { numero } = orderArgs.parse(raw);
      // Filtra pelo dono no banco: pedido de outra conta é "não encontrado",
      // sem revelar que o número existe.
      const order = await getOrderByNumber(numero, context.userId);
      if (!order) return { erro: "nao_encontrado", instrucao: "Nenhum pedido com esse número nesta conta." };
      return {
        numero: order.orderNumber,
        status: statusLabel(order.status),
        itens: order.items.map((item) => `${item.quantity}× ${item.productNameSnapshot}`),
        total: formatPriceCents(order.totalCents),
        pagamento: order.paymentMethod ? `${order.paymentMethod}: ${order.paymentStatus}` : "aguardando confirmação",
        link: `/pedido/${order.orderNumber}`,
      };
    },
  },

  registrar_orcamento: {
    spec: {
      type: "function",
      function: {
        name: "registrar_orcamento",
        description:
          "Registra um pedido de orçamento de serviço. Só chame depois que a pessoa CONFIRMAR o resumo com todos os dados.",
        parameters: {
          type: "object",
          properties: {
            servico: { type: "string", enum: SERVICES.map((service) => service.kind) },
            nome: { type: "string" },
            email: { type: "string" },
            telefone: { type: "string", description: "Opcional, DDD + número." },
            descricao: { type: "string", description: "O que precisa ser feito, com pelo menos 20 caracteres." },
          },
          required: ["servico", "nome", "email", "descricao"],
        },
      },
    },
    async run(raw, context) {
      const args = serviceArgs.parse(raw);
      // Mesma validação do formulário de /servicos, campo a campo.
      const form = new FormData();
      form.set("kind", args.servico);
      form.set("name", args.nome);
      form.set("email", args.email);
      form.set("phone", args.telefone ?? "");
      form.set("details", args.descricao);
      const parsed = parseServiceRequestForm(form);
      if (!parsed.ok) return { erro: "dados_invalidos", campos: parsed.errors };

      const result = await submitServiceRequest({ values: parsed.values, ip: context.ip, userId: context.userId });
      if (!result.ok) {
        return { erro: "limite", instrucao: `Limite de pedidos atingido. Nova tentativa em ${Math.ceil(result.retryAfterSeconds / 60)} min.` };
      }
      return { protocolo: result.protocol, instrucao: "Informe o protocolo à pessoa." };
    },
  },
};

export const ASSISTANT_TOOLS: ChatTool[] = Object.values(TOOLS).map((tool) => tool.spec);

/** Lista de categorias para as instruções (nome → slug que `buscar_produtos` aceita). */
export async function categoryHints(): Promise<string> {
  return (await getCategories()).map((category) => `${category.name} (${category.slug})`).join(", ");
}

/**
 * Executa uma ferramenta pedida pelo modelo. Erro DO MODELO (ferramenta que
 * não existe, argumento inválido) volta como resultado para ele se corrigir ou
 * explicar à pessoa — a conversa não cai por isso. Falha de infraestrutura
 * (banco fora) propaga: não é algo que o modelo conserte.
 */
export async function runTool(name: string, rawArguments: string, context: AssistantContext): Promise<ToolResult> {
  const tool = TOOLS[name];
  if (!tool) return { erro: "ferramenta_inexistente" };
  let args: unknown;
  try {
    args = rawArguments.trim() ? JSON.parse(rawArguments) : {};
  } catch {
    return { erro: "argumentos_invalidos", instrucao: "Os argumentos precisam ser JSON." };
  }
  try {
    return await tool.run(args, context);
  } catch (error) {
    if (error instanceof z.ZodError) return { erro: "argumentos_invalidos", detalhes: z.flattenError(error).fieldErrors };
    throw error;
  }
}
