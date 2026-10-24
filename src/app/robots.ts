import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/** Indexa as páginas públicas; área logada, admin e API ficam de fora. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/conta", "/carrinho", "/checkout", "/pedido", "/favoritos", "/entrar", "/cadastro", "/api"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
