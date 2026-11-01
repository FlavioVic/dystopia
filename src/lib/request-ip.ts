import { headers } from "next/headers";
import { createLogger } from "@/lib/logger";

const logger = createLogger("request-ip");

/** Chave usada quando não dá para saber o IP com segurança: todos dividem o limite. */
export const UNTRUSTED_IP = "ip-nao-confiavel";

type Env = { VERCEL?: string; TRUST_PROXY_HEADERS?: string; NODE_ENV?: string };

/**
 * IP do cliente para a chave do limite de tentativas. `X-Real-IP` e
 * `X-Forwarded-For` são escritos por quem está na frente do app — e, sem
 * proxy confiável, pelo próprio cliente, que forjaria um contador novo a cada
 * tentativa (força bruta sem limite). Só confia neles:
 * - na Vercel (a borda sobrescreve os headers);
 * - com `TRUST_PROXY_HEADERS=1` (proxy reverso próprio que sobrescreve, como
 *   o Caddy do docker-compose);
 * - com `TRUST_PROXY_HEADERS=cloudfront` (AWS: CloudFront → load balancer):
 *   aí o `X-Forwarded-For` não serve — o CloudFront ACRESCENTA o IP ao que o
 *   cliente mandou, então o primeiro da lista é forjável. Vale o
 *   `CloudFront-Viewer-Address`, que só o CloudFront escreve (e o load
 *   balancer só aceita conexão vinda do CloudFront — ver infra/app);
 * - fora de produção (dev e testes).
 * Em produção sem nenhum dos dois, falha fechado: todos dividem um contador.
 */
export function resolveClientIp(header: (name: string) => string | null | undefined, env: Env): string {
  if (env.TRUST_PROXY_HEADERS === "cloudfront") {
    return viewerIp(header("cloudfront-viewer-address")) ?? UNTRUSTED_IP;
  }
  const trusted = env.VERCEL === "1" || env.TRUST_PROXY_HEADERS === "1" || env.NODE_ENV !== "production";
  if (!trusted) return UNTRUSTED_IP;
  const realIp = header("x-real-ip")?.trim();
  if (realIp) return realIp;
  return header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/**
 * `CloudFront-Viewer-Address` é "IP:porta" — no IPv6 sem colchetes
 * ("2001:db8::1:46532"), então a porta é o que vem depois do ÚLTIMO ":".
 */
function viewerIp(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const separator = raw.lastIndexOf(":");
  const ip = separator > 0 ? raw.slice(0, separator) : raw;
  return ip || null;
}

let warned = false;

export async function getRequestIp(): Promise<string> {
  const store = await headers();
  const ip = resolveClientIp((name) => store.get(name), process.env);
  if (ip === UNTRUSTED_IP && !warned) {
    warned = true;
    logger.error("sem proxy confiável: limite de tentativas compartilhado por todos", {
      fix: "rode atrás de um proxy que sobrescreva X-Real-IP e defina TRUST_PROXY_HEADERS=1",
    });
  }
  return ip;
}
