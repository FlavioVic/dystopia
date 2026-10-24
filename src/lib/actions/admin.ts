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
import { orders } from "@/db/schema";
import { getCurrentUser } from "@/lib/data/auth";
import { canTransition, isOrderStatus, ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/order-status";
import { parseCouponForm } from "@/lib/validation/coupon";
import { parseProductForm, field } from "@/lib/validation/product";
import { parseVariantForm } from "@/lib/validation/variant";
import * as queue from "@/queue";
import * as catalog from "@/services/catalog";
import * as couponsService from "@/services/coupons";
import { transitionOrder } from "@/services/orders";
import * as serviceRequestsService from "@/services/service-requests";
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
  try {
    await catalog.setProductFlag(db, id, flag);
  } catch (error) {
    if (error instanceof PermanentError) return { ok: false, error: error.message };
    throw error;
  }
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
    await catalog.updateProduct(db, id, values);
  } catch (error) {
    if (error instanceof PermanentError) return { message: error.message };
    throw error;
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
    await catalog.createProduct(db, values, { imageUrl });
  } catch (error) {
    if (error instanceof PermanentError) return { message: error.message };
    throw error;
  }
  redirect("/admin/produtos");
}

// ---------------------------------------------------------------------------
// Variantes
// ---------------------------------------------------------------------------

export async function createVariant(
  productId: string,
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await ensureAdmin();
  const { errors, values } = parseVariantForm(formData);
  if (Object.keys(errors).length > 0) return { errors };

  try {
    await catalog.createVariant(db, productId, values);
  } catch (error) {
    if (error instanceof PermanentError) return { message: error.message };
    throw error;
  }
  refresh();
  return { message: undefined };
}

export async function updateVariant(
  variantId: string,
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await ensureAdmin();
  const { errors, values } = parseVariantForm(formData);
  if (Object.keys(errors).length > 0) return { errors };

  try {
    await catalog.updateVariant(db, variantId, values);
  } catch (error) {
    if (error instanceof PermanentError) return { message: error.message };
    throw error;
  }
  refresh();
  return { message: undefined };
}

export async function removeVariant(variantId: string): Promise<SimpleResult> {
  await ensureAdmin();
  const { deleted } = await catalog.deleteVariant(db, variantId);
  if (!deleted) return { ok: false, error: "Variante não encontrada." };
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Cupons
// ---------------------------------------------------------------------------

export async function createCoupon(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await ensureAdmin();
  const { errors, values } = parseCouponForm(formData);
  if (Object.keys(errors).length > 0) return { errors };

  try {
    await couponsService.createCoupon(db, values);
  } catch (error) {
    if (error instanceof PermanentError) return { message: error.message };
    throw error;
  }
  redirect("/admin/cupons");
}

export async function updateCoupon(
  couponId: string,
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await ensureAdmin();
  const { errors, values } = parseCouponForm(formData);
  if (Object.keys(errors).length > 0) return { errors };

  try {
    await couponsService.updateCoupon(db, couponId, values);
  } catch (error) {
    if (error instanceof PermanentError) return { message: error.message };
    throw error;
  }
  redirect("/admin/cupons");
}

export async function toggleCouponActive(couponId: string): Promise<SimpleResult> {
  await ensureAdmin();
  try {
    await couponsService.setCouponActive(db, couponId);
  } catch (error) {
    if (error instanceof PermanentError) return { ok: false, error: error.message };
    throw error;
  }
  refresh();
  return { ok: true };
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

/** Muda o andamento de um pedido de orçamento (painel /admin/orcamentos). */
export async function updateServiceRequestStatus(id: string, status: string): Promise<SimpleResult> {
  await ensureAdmin();
  try {
    await serviceRequestsService.updateServiceRequestStatus(db, id, status);
  } catch (error) {
    if (error instanceof PermanentError) return { ok: false, error: error.message };
    throw error;
  }
  refresh();
  return { ok: true };
}
