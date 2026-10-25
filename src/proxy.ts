import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/lib/csp";

/**
 * Nonce novo a cada request para CSP. O Next lê o nonce do header da request e
 * aplica nos scripts dele; os `<script>` escritos à mão no layout leem de
 * `x-nonce`. Todas as páginas já são dinâmicas (o layout lê sessão e
 * carrinho), então o nonce não custa cache.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, { dev: process.env.NODE_ENV === "development" });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Asset estático, imagem otimizada e rota de API não renderizam HTML.
      source: "/((?!api|_next/static|_next/image|favicon.ico|images|portfolio).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
