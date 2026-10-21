"use server";

/**
 * Server Actions do painel admin.
 *
 * Toda função checa `role = admin` antes de escrever (`ensureAdmin`) — o
 * layout protegido não basta, Server Action é endpoint público.
 * A validação do formulário de produto fica em `@/lib/validation/product`
 * (função pura, testada) e a transição de status em `@/lib/order-status`.
 */

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, productImages, products } from "@/db/schema";
import { getCurrentUser } from "@/lib/data/auth";
import { canTransition, isOrderStatus, ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/order-status";
import { parseProductForm, field } from "@/lib/validation/product";
import * as queue from "@/queue";
import { transitionOrder } from "@/services/orders";
import { PermanentError } from "@/saga/errors";

async function ensureAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") throw new Error("Não autorizado.");
}

export type AdminFormState = { errors?: Record<string, string>; message?: string } | undefined;
export type SimpleResult = { ok: boolean; error?: string };

export async function updateOrderStatus(orderId: string, status: string): Promise<SimpleResult> {
  await ensureAdmin();
  if (!isOrderStatus(status)) return { ok: false, error: "Status inválido." };

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: { id: true, status: true },
  });
  if (!order) return { ok: false, error: "Pedido não encontrado." };

  const current = order.status as OrderStatus;
  if (current !== status && !canTransition(current, status)) {
    return {
      ok: false,
      error: `Não é possível ir de "${ORDER_STATUS_LABELS[current]}" para "${ORDER_STATUS_LABELS[status]}".`,
    };
  }

  try {
    await transitionOrder(db, orderId, status);
  } catch (error) {
    if (error instanceof PermanentError) return { ok: false, error: error.message };
    throw error;
  }

  refresh();
  return { ok: true };
}

export async function toggleProductFlag(
  id: string,
  flag: "isActive" | "isFeatured",
): Promise<SimpleResult> {
  await ensureAdmin();
  const product = await db.query.products.findFirst({
    where: eq(products.id, id),
    columns: { isActive: true, isFeatured: true },
  });
  if (!product) return { ok: false, error: "Produto não encontrado." };

  const value = !product[flag];
  await db
    .update(products)
    .set(
      flag === "isActive"
        ? { isActive: value, updatedAt: new Date() }
        : { isFeatured: value, updatedAt: new Date() },
    )
    .where(eq(products.id, id));
  refresh();
  return { ok: true };
}

export async function updateProduct(
  id: string,
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await ensureAdmin();
  const { errors, values } = parseProductForm(formData);
  if (Object.keys(errors).length > 0) return { errors };

  try {
    await db
      .update(products)
      .set({
        name: values.name,
        slug: values.slug,
        description: values.description,
        brand: values.brand,
        sku: values.sku,
        categoryId: values.categoryId,
        priceCents: values.priceCents,
        compareAtPriceCents: values.compareAtPriceCents,
        stockQuantity: values.stockQuantity,
        isActive: values.isActive,
        isFeatured: values.isFeatured,
        updatedAt: new Date(),
      })
      .where(eq(products.id, id));
  } catch {
    return { message: "Não foi possível salvar — slug ou SKU já em uso?" };
  }
  redirect("/admin/produtos");
}

export async function createProduct(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await ensureAdmin();
  const { errors, values } = parseProductForm(formData);
  const imageUrl = field(formData, "imageUrl") || null;
  if (Object.keys(errors).length > 0) return { errors };

  try {
    const [created] = await db
      .insert(products)
      .values({
        name: values.name,
        slug: values.slug,
        description: values.description,
        brand: values.brand,
        sku: values.sku,
        categoryId: values.categoryId,
        priceCents: values.priceCents,
        compareAtPriceCents: values.compareAtPriceCents,
        stockQuantity: values.stockQuantity,
        isActive: values.isActive,
        isFeatured: values.isFeatured,
      })
      .returning({ id: products.id });
    if (imageUrl && created) {
      await db.insert(productImages).values({
        productId: created.id,
        url: imageUrl,
        altText: values.name,
        position: 0,
      });
    }
  } catch {
    return { message: "Não foi possível criar — slug ou SKU já em uso?" };
  }
  redirect("/admin/produtos");
}

/** Reprocessa um job da dead-letter (painel de orquestração). */
export async function retryJob(jobId: string): Promise<SimpleResult> {
  await ensureAdmin();
  const requeued = await queue.retryDeadJob(jobId);
  if (!requeued) return { ok: false, error: "Job não está na dead-letter." };
  refresh();
  return { ok: true };
}

/** Roda a reconciliação sob demanda (painel de orquestração). */
export async function runReconcile(): Promise<SimpleResult & { report?: Record<string, number> }> {
  await ensureAdmin();
  const { reconcile } = await import("@/saga/reconcile");
  const report = await reconcile();
  refresh();
  return { ok: true, report };
}
