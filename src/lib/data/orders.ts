import { cache } from "react";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";

export const getOrderByNumber = cache(async (orderNumber: string, userId: string) => {
  return db.query.orders.findFirst({
    where: and(eq(orders.orderNumber, orderNumber), eq(orders.userId, userId)),
    with: {
      items: true,
      shippingAddress: true,
      coupon: true,
    },
  });
});

export const getUserOrders = cache(async (userId: string) => {
  return db.query.orders.findMany({
    where: eq(orders.userId, userId),
    orderBy: (o, { desc }) => [desc(o.createdAt)],
    with: { items: { columns: { id: true } } },
    limit: 10,
  });
});
