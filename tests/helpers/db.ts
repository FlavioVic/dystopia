/**
 * Utilidades de banco pros testes de integração.
 *
 * Usa o MESMO `db` da aplicação (o runner aponta `DATABASE_URL` pro banco de
 * teste antes de subir o processo), então o que os testes exercitam é o código
 * de produção de verdade — não um mock.
 */

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, pgPool } from "@/db";
import {
  cartItems,
  carts,
  categories,
  coupons,
  productVariants,
  products,
  users,
} from "@/db/schema";

/** Ordem importa menos aqui porque é CASCADE, mas manter explícito documenta o grafo. */
const TABLES = [
  "rate_limits",
  "notifications",
  "saga_steps",
  "sagas",
  "jobs",
  "wishlist_items",
  "service_requests",
  "reviews",
  "payments",
  "order_items",
  "orders",
  "cart_items",
  "carts",
  "coupons",
  "product_variants",
  "product_images",
  "products",
  "categories",
  "addresses",
  "users",
];

export async function resetDatabase(): Promise<void> {
  await db.execute(sql.raw(`truncate table ${TABLES.join(", ")} restart identity cascade`));
}

export async function closeDatabase(): Promise<void> {
  await pgPool.end();
}

export type ProductFixture = {
  id: string;
  priceCents: number;
  stockQuantity: number;
};

export type CheckoutFixture = {
  userId: string;
  userEmail: string;
  userName: string;
  categoryId: string;
  product: ProductFixture;
  variantId: string | null;
  cartId: string;
  couponId: string | null;
  couponCode: string | null;
};

export type FixtureOptions = {
  stock?: number;
  priceCents?: number;
  quantity?: number;
  withVariant?: boolean;
  variantStock?: number;
  coupon?: {
    discountType?: "percentage" | "fixed";
    discountValue?: number;
    maxUsage?: number | null;
    usageCount?: number;
    minOrderCents?: number;
    isActive?: boolean;
    validFrom?: Date;
    validUntil?: Date | null;
  } | null;
};

/** Cria usuário + catálogo + carrinho com itens (e cupom, se pedido). */
export async function seedCheckoutFixture(options: FixtureOptions = {}): Promise<CheckoutFixture> {
  const stock = options.stock ?? 10;
  const priceCents = options.priceCents ?? 9_990;
  const quantity = options.quantity ?? 2;
  const suffix = randomUUID().slice(0, 8);

  const [user] = await db
    .insert(users)
    .values({
      email: `cliente-${suffix}@teste.dev`,
      passwordHash: "hash-de-teste",
      name: "Cliente Teste",
    })
    .returning({ id: users.id, email: users.email, name: users.name });

  const [category] = await db
    .insert(categories)
    .values({ name: `Categoria ${suffix}`, slug: `categoria-${suffix}` })
    .returning({ id: categories.id });

  const [product] = await db
    .insert(products)
    .values({
      categoryId: category.id,
      name: `Produto ${suffix}`,
      slug: `produto-${suffix}`,
      description: "Produto de teste",
      sku: `SKU-${suffix}`,
      priceCents,
      stockQuantity: stock,
    })
    .returning({ id: products.id });

  let variantId: string | null = null;
  if (options.withVariant) {
    const [variant] = await db
      .insert(productVariants)
      .values({
        productId: product.id,
        name: "M / Preto",
        sku: `SKU-${suffix}-M`,
        stockQuantity: options.variantStock ?? stock,
      })
      .returning({ id: productVariants.id });
    variantId = variant.id;
  }

  const [cart] = await db
    .insert(carts)
    .values({ userId: user.id, sessionToken: `sessao-${suffix}` })
    .returning({ id: carts.id });

  await db.insert(cartItems).values({
    cartId: cart.id,
    productId: product.id,
    variantId,
    quantity,
    unitPriceCents: priceCents,
  });

  let couponId: string | null = null;
  let couponCode: string | null = null;
  if (options.coupon) {
    couponCode = `TESTE${suffix.toUpperCase().slice(0, 4)}`;
    const [coupon] = await db
      .insert(coupons)
      .values({
        code: couponCode,
        discountType: options.coupon.discountType ?? "percentage",
        discountValue: options.coupon.discountValue ?? 10,
        minOrderCents: options.coupon.minOrderCents ?? 0,
        maxUsage: options.coupon.maxUsage ?? null,
        usageCount: options.coupon.usageCount ?? 0,
        isActive: options.coupon.isActive ?? true,
        validFrom: options.coupon.validFrom ?? new Date(Date.now() - 86_400_000),
        validUntil: options.coupon.validUntil ?? null,
      })
      .returning({ id: coupons.id });
    couponId = coupon.id;
  }

  return {
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
    categoryId: category.id,
    product: { id: product.id, priceCents, stockQuantity: stock },
    variantId,
    cartId: cart.id,
    couponId,
    couponCode,
  };
}
