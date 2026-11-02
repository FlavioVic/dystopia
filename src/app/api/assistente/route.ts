import { handleAssistantMessage, isSameOrigin } from "@/lib/assistant/handler";
import { chatConfigFromEnv, createChatCompletion } from "@/lib/assistant/provider";
import { getRequestIp } from "@/lib/request-ip";
import { readJsonBody } from "@/lib/request-body";
import { getCurrentUser } from "@/lib/data/auth";
import { MAX_BODY_BYTES } from "@/lib/validation/assistant";

/**
 * Assistente da loja. Quem a pessoa é sai da sessão (cookie), nunca
 * do corpo; o resto mora em `lib/assistant/handler.ts`.
 */

export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  const config = chatConfigFromEnv();
  if (!config) return Response.json({ error: "Assistente desligado." }, { status: 404 });

  // Origem antes do corpo: chamada de outro site não custa nem a leitura.
  // (O handler confere de novo — ele é a regra; aqui é economia.)
  if (!isSameOrigin(request.headers)) return Response.json({ error: "Origem não permitida." }, { status: 403 });

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) {
    const error = body.status === 413 ? "Conversa longa demais." : "Pedido inválido.";
    return Response.json({ error }, { status: body.status });
  }

  const user = await getCurrentUser();
  const result = await handleAssistantMessage({
    headers: request.headers,
    body: body.value,
    context: { userId: user?.id ?? null, ip: await getRequestIp() },
    complete: createChatCompletion(config),
  });
  return Response.json(result.body, { status: result.status });
}
