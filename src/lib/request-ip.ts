import { headers } from "next/headers";

/**
 * IP de quem fez o request, pra chave de limite de tentativas.
 *
 * Confia em `x-real-ip`/`x-forwarded-for` porque na Vercel quem escreve esses
 * headers é a borda da plataforma (o valor do cliente é sobrescrito). Atrás de
 * outro proxy isso precisa ser revisto: sem proxy confiável, o cliente forja o
 * header e ganha um contador novo a cada tentativa.
 */
export async function getRequestIp(): Promise<string> {
  const store = await headers();
  const realIp = store.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = store.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}
