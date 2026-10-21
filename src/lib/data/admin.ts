import { cache } from "react";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, coupons, orders, products } from "@/db/schema";

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
      revenue: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
    })
    .from(orders);
  return { productsActive: p.total, lowStock: p.low, ordersCount: o.count, revenueCents: o.revenue };
});

export const getAllOrders = cache(async (limit?: number) => {
  return db.query.orders.findMany({
    orderBy: (o, { desc }) => [desc(o.createdAt)],
    limit,
    with: {
      user: { columns: { name: true, email: true } },
      items: { columns: { id: true } },
    },
  });
});

export const getAdminOrder = cache(async (orderNumber: string) => {
  return db.query.orders.findFirst({
    where: eq(orders.orderNumber, orderNumber),
    with: {
      user: { columns: { name: true, email: true } },
      items: true,
      payments: true,
      shippingAddress: true,
      coupon: true,
    },
  });
});

export const getAllProductsAdmin = cache(async () => {
  return db.query.products.findMany({
    orderBy: (p, { asc }) => [asc(p.name)],
    with: {
      category: { columns: { name: true } },
      images: { columns: { url: true }, orderBy: (i, { asc }) => [asc(i.position)] },
    },
  });
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
