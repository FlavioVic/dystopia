import type { NextConfig } from "next";
import { blobPublicHostname } from "./src/lib/blob-host";

/* Fotos enviadas pelo painel: só o store da loja (ver src/lib/blob-host.ts). */
const blobHost = blobPublicHostname(process.env);

const nextConfig: NextConfig = {
  /* Sem `X-Powered-By: Next.js`: não anuncia o framework (e a versão a
   * procurar em lista de CVE) para quem varre o site. */
  poweredByHeader: false,
  /* Só no build da imagem Docker (docker/Dockerfile.web): servidor autocontido. Na
   * Vercel e no `next start` local fica o padrão. */
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  images: {
    /* SVG não passa pelo otimizador: as placas técnicas (/public/images, .svg)
     * saem direto, porque o next/image pula a otimização sozinho quando o src
     * termina em .svg. Liberar SVG no otimizador (`dangerouslyAllowSVG`) é a
     * porta das falhas de SVG (como a de outubro de 2026, no sharp). A CSP com
     * sandbox fica como segunda trava para o que o otimizador servir. */
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    remotePatterns: blobHost ? [{ protocol: "https", hostname: blobHost }] : [],
  },
  experimental: {
    serverActions: {
      /* Envio de foto pelo painel: até 3 MB (lib/product-media.ts) mais a folga
       * do multipart. A Vercel corta o corpo em 4,5 MB de qualquer jeito. */
      bodySizeLimit: "3.5mb",
    },
  },
  /* Headers de segurança em toda resposta. A CSP completa (com nonce por
   * request) vem do `src/proxy.ts`; esta `frame-ancestors` cobre o que o proxy
   * não processa (assets, API). */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          /* Janela aberta por outro site não segura referência a esta (nem o
           * contrário): fecha XS-Leaks e o tabnabbing pelo `window.opener`. */
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
