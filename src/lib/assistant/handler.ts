/**
 * `POST /api/assistente` sem o Next: origem, limite por IP, validação, a
 * conversa e a tradução de erro em resposta. A rota só junta sessão, IP e
 * config — é assim que dá para testar tudo isto contra o banco real.
 */

import { db } from "@/db";
import { getActiveCoupons } from "@/lib/data/products";
import { formatPriceCents } from "@/lib/format";
import { createLogger } from "@/lib/logger";
import { limitFromEnv } from "@/lib/rate-limit-config";
import { parseAssistantRequest } from "@/lib/validation/assistant";
import { consumeRateLimit, type RateLimitRule } from "@/services/rate-limit";
import { answer } from "./agent";
import { buildSystemPrompt } from "./prompt";
import { AssistantBusyError, AssistantUnavailableError, type CompleteChat } from "./provider";
import { ASSISTANT_TOOLS, type AssistantContext, categoryHints, runTool } from "./tools";

const log = createLogger("assistente");

// Cada mensagem custa tokens da cota do provedor (que é da loja inteira):
// limite por IP para uma pessoa só não esgotar o assistente de todo mundo.
const MESSAGE_RULE: RateLimitRule = { limit: limitFromEnv("ASSISTANT_LIMIT_PER_10MIN", 20), windowSeconds: 10 * 60 };

/**
 * Só aceita chamada da própria página. Sem isto, outro site poderia fazer o
 * navegador de um visitante logado conversar (e registrar orçamento) em nome
 * dele. `fetch` de outra origem com JSON já esbarra no CORS, mas não se
 * depende disso.
 */
export function isSameOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export type AssistantResponse = {
  status: number;
  body: { reply: string } | { error: string };
};

export async function handleAssistantMessage(input: {
  headers: Headers;
  body: unknown;
  context: AssistantContext;
  complete: CompleteChat;
}): Promise<AssistantResponse> {
  if (!isSameOrigin(input.headers)) return { status: 403, body: { error: "Origem não permitida." } };

  const parsed = parseAssistantRequest(input.body);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };

  const limit = await consumeRateLimit(db, `assistant:ip:${input.context.ip}`, MESSAGE_RULE);
  if (!limit.allowed) {
    const minutes = Math.ceil(limit.retryAfterSeconds / 60);
    return { status: 429, body: { error: `Limite de mensagens atingido. Nova tentativa em ${minutes} min.` } };
  }

  const [categories, coupons] = await Promise.all([categoryHints(), getActiveCoupons()]);
  const systemPrompt = buildSystemPrompt({
    loggedIn: input.context.userId !== null,
    categories,
    coupons: coupons.map((coupon) => {
      const value = coupon.discountType === "percentage" ? `${coupon.discountValue}%` : formatPriceCents(coupon.discountValue);
      return `${coupon.code}: ${value} acima de ${formatPriceCents(coupon.minOrderCents)}`;
    }),
  });

  try {
    const { reply, toolsUsed } = await answer({
      systemPrompt,
      history: parsed.value.history,
      tools: ASSISTANT_TOOLS,
      complete: input.complete,
      runTool: (name, args) => runTool(name, args, input.context),
    });
    log.info("resposta", { tools: toolsUsed, loggedIn: input.context.userId !== null });
    return { status: 200, body: { reply } };
  } catch (error) {
    if (error instanceof AssistantBusyError) {
      return { status: 503, body: { error: `Muitas perguntas ao mesmo tempo. Tente de novo em ${error.retryAfterSeconds} s.` } };
    }
    if (error instanceof AssistantUnavailableError) {
      log.error("provedor indisponível", { error: error.message });
      return { status: 503, body: { error: "Assistente indisponível no momento." } };
    }
    throw error;
  }
}
