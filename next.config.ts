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
};

export default nextConfig;
