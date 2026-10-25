import { handleAssistantMessage } from "@/lib/assistant/handler";
import { chatConfigFromEnv, createChatCompletion } from "@/lib/assistant/provider";
import { getRequestIp } from "@/lib/request-ip";
import { getSession } from "@/lib/session";

/**
 * Assistente da loja. Quem a pessoa é sai da sessão (cookie assinado), nunca
 * do corpo; o resto mora em `lib/assistant/handler.ts`.
 */

export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  const config = chatConfigFromEnv();
  if (!config) return Response.json({ error: "Assistente desligado." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const session = await getSession();
  const result = await handleAssistantMessage({
    headers: request.headers,
    body,
    context: { userId: session?.userId ?? null, ip: await getRequestIp() },
    complete: createChatCompletion(config),
  });
  return Response.json(result.body, { status: result.status });
}
