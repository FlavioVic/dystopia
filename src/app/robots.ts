import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

const PRIVATE = ["/admin", "/conta", "/carrinho", "/checkout", "/pedido", "/favoritos", "/entrar", "/cadastro", "/api"];

/**
 * Robôs de busca e de assistentes de IA (GEO), nomeados um a um: o `*` já
 * libera, mas regra explícita deixa claro que o site QUER ser lido e citado
 * por eles — e trava a mesma área privada. O resumo para IA fica em /llms.txt.
 */
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Bingbot",
];

/** Indexa as páginas públicas; área logada, admin e API ficam de fora. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE },
      { userAgent: AI_CRAWLERS, allow: ["/", "/llms.txt"], disallow: PRIVATE },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
