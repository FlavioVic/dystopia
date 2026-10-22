import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    /* O catálogo usa ilustrações SVG locais em /public/images. O otimizador do
     * next/image bloqueia SVG por padrão; como são assets próprios e confiáveis,
     * liberamos com CSP + sandbox (neutraliza qualquer script embutido). */
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  /* Headers de segurança em toda resposta. A CSP aqui só proíbe a loja de ser
   * embutida em iframe (clickjacking no login/checkout); uma CSP completa
   * exigiria nonce nos scripts inline do Next a cada request. */
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
