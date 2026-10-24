import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Só no build da imagem Docker (Dockerfile.web): servidor autocontido. Na
   * Vercel e no `next start` local fica o padrão. */
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  images: {
    /* O catálogo usa ilustrações SVG locais em /public/images. O otimizador do
     * next/image bloqueia SVG por padrão; como são assets próprios e confiáveis,
     * liberamos com CSP + sandbox (neutraliza qualquer script embutido). */
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
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
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
