import { headers } from "next/headers";
import { createLogger } from "@/lib/logger";
import { isIPv4, isIPv6 } from "node:net";

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
 *
 * IPv6 sai como o bloco /64 (ver `limitKeyForIp`): é a chave do limite, não o
 * endereço exato.
 */
export function resolveClientIp(header: (name: string) => string | null | undefined, env: Env): string {
  if (env.TRUST_PROXY_HEADERS === "cloudfront") {
    const viewer = viewerIp(header("cloudfront-viewer-address"));
    return viewer ? limitKeyForIp(viewer) : UNTRUSTED_IP;
  }
  const trusted = env.VERCEL === "1" || env.TRUST_PROXY_HEADERS === "1" || env.NODE_ENV !== "production";
  if (!trusted) return UNTRUSTED_IP;
  const realIp = header("x-real-ip")?.trim();
  if (realIp) return limitKeyForIp(realIp);
  const forwarded = header("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded ? limitKeyForIp(forwarded) : "unknown";
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

/**
 * Chave do limite para um IP. IPv4 fica como está; IPv6 vira o bloco /64 —
 * o provedor entrega o bloco inteiro a um cliente só (2^64 endereços), e quem
 * ataca trocaria de endereço a cada tentativa, ganhando um contador novo em
 * cada uma. É o que o `express-rate-limit` faz por padrão desde a v8. IPv4
 * escrito como IPv6 (`::ffff:1.2.3.4`) volta a ser IPv4.
 */
export function limitKeyForIp(ip: string): string {
  const bare = ip.split("%")[0];
  if (!isIPv6(bare)) return ip;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare);
  if (mapped && isIPv4(mapped[1])) return mapped[1];
  return `${firstHextets(bare, 4).join(":")}::/64`;
}

/** Os `count` primeiros grupos de 16 bits, por extenso e sem zero à esquerda. */
function firstHextets(ip: string, count: number): string[] {
  const groupsOf = (part: string) => (part ? part.split(":") : []);
  // IPv4 no fim (ex.: 64:ff9b::1.2.3.4) ocupa dois grupos.
  const width = (groups: string[]) => groups.reduce((n, g) => n + (g.includes(".") ? 2 : 1), 0);
  const [head, tail] = ip.includes("::") ? ip.split("::") : [ip, undefined];
  const headGroups = groupsOf(head);
  const tailGroups = tail === undefined ? [] : groupsOf(tail);
  const zeros = tail === undefined ? 0 : 8 - width(headGroups) - width(tailGroups);
  const all = [...headGroups, ...Array<string>(zeros).fill("0"), ...tailGroups];
  return all.slice(0, count).map((g) => (g.includes(".") ? "0" : parseInt(g, 16).toString(16)));
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
