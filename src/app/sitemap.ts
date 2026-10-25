import type { MetadataRoute } from "next";
import { getCategories, getProductSitemapEntries } from "@/lib/data/products";
import { SITE_URL } from "@/lib/site";

// Gerado na hora: o build não depende do banco (imagem Docker, deploy com o
// banco fora), e a consulta é leve — só slug e data dos produtos ativos.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [categories, products] = await Promise.all([getCategories(), getProductSitemapEntries()]);
  const now = new Date();
  const page = (path: string, priority: number, changeFrequency: "weekly" | "monthly" = "monthly") => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  });

  return [
    page("/", 1, "weekly"),
    page("/servicos", 0.9),
    page("/portfolio", 0.9),
    page("/produtos", 0.8, "weekly"),
    page("/sobre", 0.5),
    page("/creditos", 0.2),
    ...categories.map((c) => page(`/categoria/${c.slug}`, 0.7, "weekly")),
    ...products.map((p) => ({ ...page(`/produto/${p.slug}`, 0.6, "weekly"), lastModified: p.updatedAt })),
  ];
}
