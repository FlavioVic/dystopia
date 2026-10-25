import { cache } from "react";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, coupons, products, productSearchDocument } from "@/db/schema";
import type { Page } from "@/lib/pagination";
import { toPrefixQuery } from "@/lib/search";

const activeProduct = eq(products.isActive, true);

export const getCategories = cache(async () => {
  return db.query.categories.findMany({
    orderBy: (c, { asc }) => [asc(c.name)],
  });
});

export const getCategoryBySlug = cache(async (slug: string) => {
  return db.query.categories.findFirst({
    where: eq(categories.slug, slug),
  });
});

export const getFeaturedProducts = cache(async (limit = 8) => {
  return db.query.products.findMany({
    where: and(eq(products.isFeatured, true), eq(products.isActive, true)),
    with: { category: true, images: { orderBy: (i, { asc }) => [asc(i.position)] } },
    orderBy: (p, { desc }) => [desc(p.createdAt)],
    limit,
  });
});

export const getProductsByCategorySlug = cache(async (slug: string, page: Page) => {
  const category = await getCategoryBySlug(slug);
  if (!category) return { category: null, products: [], total: 0 };

  const where = and(eq(products.categoryId, category.id), activeProduct);
  const [list, total] = await Promise.all([
    db.query.products.findMany({
      where,
      with: { images: { orderBy: (i, { asc }) => [asc(i.position)] } },
      orderBy: (p, { desc }) => [desc(p.createdAt), desc(p.id)],
      limit: page.limit,
      offset: page.offset,
    }),
    db.$count(products, where),
  ]);

  return { category, products: list, total };
});

/** Uma página do inventário ativo, mais o total (para paginação). */
export const listActiveProducts = cache(async (page: Page) => {
  const [items, total] = await Promise.all([
    db.query.products.findMany({
      where: activeProduct,
      with: { category: true, images: { orderBy: (i, { asc }) => [asc(i.position)] } },
      orderBy: (p, { desc }) => [desc(p.createdAt), desc(p.id)],
      limit: page.limit,
      offset: page.offset,
    }),
    db.$count(products, activeProduct),
  ]);
  return { items, total };
});

export const countActiveProducts = cache(async () => db.$count(products, activeProduct));

/** Só o que o sitemap precisa — não o catálogo inteiro com imagens. */
export const getProductSitemapEntries = cache(async () =>
  db.select({ slug: products.slug, updatedAt: products.updatedAt }).from(products).where(activeProduct),
);

/**
 * Busca full-text (índice GIN em `productSearchDocument`): cada palavra como
 * prefixo, sem acento, mais relevante primeiro — nome/marca/SKU acima de
 * descrição.
 */
export const searchProducts = cache(async (query: string, page: Page) => {
  const tsquery = toPrefixQuery(query);
  if (!tsquery) return { items: [], total: 0 };
  const match = sql`to_tsquery('portuguese'::regconfig, f_unaccent(${tsquery}))`;
  const document = productSearchDocument(products);
  const where = and(activeProduct, sql`${document} @@ ${match}`);
  const [items, total] = await Promise.all([
    db.query.products.findMany({
      where,
      with: { category: true, images: { orderBy: (i, { asc }) => [asc(i.position)] } },
      orderBy: (p, { desc }) => [desc(sql`ts_rank(${document}, ${match})`), desc(p.isFeatured), desc(p.id)],
      limit: page.limit,
      offset: page.offset,
    }),
    db.$count(products, where),
  ]);
  return { items, total };
});

export const getActiveCoupons = cache(async () => {
  return db.query.coupons.findMany({
    where: eq(coupons.isActive, true),
    columns: {
      code: true,
      description: true,
      discountType: true,
      discountValue: true,
      minOrderCents: true,
    },
    orderBy: (c, { asc }) => [asc(c.minOrderCents)],
    limit: 6,
  });
});

export const getProductBySlug = cache(async (slug: string) => {
  return db.query.products.findFirst({
    where: eq(products.slug, slug),
    with: {
      category: true,
      images: { orderBy: (i, { asc }) => [asc(i.position)] },
      variants: true,
      reviews: {
        with: { user: { columns: { name: true } } },
        orderBy: (r, { desc }) => [desc(r.createdAt)],
      },
    },
  });
});

export const getRelatedProducts = cache(async (categoryId: string, excludeProductId: string, limit = 4) => {
  return db.query.products.findMany({
    where: and(
      eq(products.categoryId, categoryId),
      eq(products.isActive, true),
      ne(products.id, excludeProductId),
    ),
    with: { images: { orderBy: (i, { asc }) => [asc(i.position)] } },
    limit,
  });
});
