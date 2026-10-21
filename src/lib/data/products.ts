import { cache } from "react";
import { and, eq, ilike, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { categories, coupons, products } from "@/db/schema";

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

export const getProductsByCategorySlug = cache(async (slug: string) => {
  const category = await getCategoryBySlug(slug);
  if (!category) return { category: null, products: [] };

  const list = await db.query.products.findMany({
    where: and(eq(products.categoryId, category.id), eq(products.isActive, true)),
    with: { images: { orderBy: (i, { asc }) => [asc(i.position)] } },
    orderBy: (p, { desc }) => [desc(p.createdAt)],
  });

  return { category, products: list };
});

export const getAllProducts = cache(async () => {
  return db.query.products.findMany({
    where: eq(products.isActive, true),
    with: { category: true, images: { orderBy: (i, { asc }) => [asc(i.position)] } },
    orderBy: (p, { desc }) => [desc(p.createdAt)],
  });
});

export const searchProducts = cache(async (query: string) => {
  const q = query.trim();
  if (!q) return [];
  const term = `%${q}%`;
  return db.query.products.findMany({
    where: and(
      eq(products.isActive, true),
      or(ilike(products.name, term), ilike(products.description, term), ilike(products.brand, term)),
    ),
    with: { category: true, images: { orderBy: (i, { asc }) => [asc(i.position)] } },
    orderBy: (p, { desc }) => [desc(p.isFeatured), desc(p.createdAt)],
  });
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
