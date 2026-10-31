import { cache } from "react";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, coupons, orders, products } from "@/db/schema";
import { REVENUE_STATUSES } from "@/lib/order-status";
import type { Page } from "@/lib/pagination";

export const getAdminStats = cache(async () => {
  const [p] = await db
    .select({
      total: sql<number>`count(*)::int`,
      low: sql<number>`(count(*) filter (where ${products.stockQuantity} <= 3))::int`,
    })
    .from(products)
    .where(eq(products.isActive, true));
  const [o] = await db
    .select({
      count: sql<number>`count(*)::int`,
      revenue: sql<number>`(coalesce(sum(${orders.totalCents}) filter (where ${inArray(orders.status, [...REVENUE_STATUSES])}), 0))::int`,
    })
    .from(orders);
  return { productsActive: p.total, lowStock: p.low, ordersCount: o.count, revenueCents: o.revenue };
});

const orderListingWith = {
  user: { columns: { name: true, email: true } },
  items: { columns: { id: true } },
} as const;

/** Os mais recentes (painel). */
export const getRecentOrders = cache(async (limit: number) =>
  db.query.orders.findMany({ with: orderListingWith, orderBy: (o, { desc }) => [desc(o.createdAt), desc(o.id)], limit }),
);

/** Uma página de pedidos, mais o total. */
export const listOrders = cache(async (page: Page) => {
  const [items, total] = await Promise.all([
    db.query.orders.findMany({
      with: orderListingWith,
      orderBy: (o, { desc }) => [desc(o.createdAt), desc(o.id)],
      limit: page.limit,
      offset: page.offset,
    }),
    db.$count(orders),
  ]);
  return { items, total };
});

export const getAdminOrder = cache(async (orderNumber: string) => {
  return db.query.orders.findFirst({
    where: eq(orders.orderNumber, orderNumber),
    with: {
      user: { columns: { name: true, email: true } },
      items: true,
      shippingAddress: true,
      coupon: true,
    },
  });
});

/** Uma página do catálogo inteiro (ativos e inativos), mais o total. */
export const listProductsAdmin = cache(async (page: Page) => {
  const [items, total] = await Promise.all([
    db.query.products.findMany({
      orderBy: (p, { asc }) => [asc(p.name), asc(p.id)],
      with: {
        category: { columns: { name: true } },
        images: { columns: { url: true }, orderBy: (i, { asc }) => [asc(i.position)] },
      },
      limit: page.limit,
      offset: page.offset,
    }),
    db.$count(products),
  ]);
  return { items, total };
});

export const getProductForEdit = cache(async (id: string) => {
  return db.query.products.findFirst({
    where: eq(products.id, id),
    with: {
      images: { orderBy: (i, { asc }) => [asc(i.position)] },
      variants: { orderBy: (v, { asc }) => [asc(v.name)] },
    },
  });
});

export const getCouponsAdmin = cache(async () => {
  return db.query.coupons.findMany({
    orderBy: (coupon, { desc }) => [desc(coupon.isActive), desc(coupon.validFrom)],
  });
});

export const getCouponForEdit = cache(async (id: string) => {
  return db.query.coupons.findFirst({ where: eq(coupons.id, id) });
});

export const getCategoriesSimple = cache(async () => {
  return db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .orderBy(categories.name);
});
