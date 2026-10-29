"use server";

/**
 * Server Actions do painel admin.
 *
 * Toda função checa `role = admin` antes de escrever (`ensureAdmin`) — o
 * layout protegido não basta, Server Action é endpoint público.
 * A validação do formulário de produto fica em `@/lib/validation/product`
 * (função pura, testada) e a transição de status em `@/lib/order-status`.
 */

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, products } from "@/db/schema";
import { getCurrentUser, isAdmin } from "@/lib/data/auth";
import { mediaStorageFromEnv } from "@/lib/media-storage";
import { IMAGE_CONTENT_TYPES, checkImageUpload } from "@/lib/product-media";
import { canTransition, isOrderStatus, ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/order-status";
import { parseCouponForm } from "@/lib/validation/coupon";
import { parseProductForm } from "@/lib/validation/product";
import { parseVariantForm } from "@/lib/validation/variant";
import { ALL_QUEUES } from "@/composition/worker";
import { replayDeadLetters } from "@/queue/dead-letters";
import * as catalog from "@/services/catalog";
import * as couponsService from "@/services/coupons";
import { transitionOrder } from "@/services/orders";
import * as serviceRequestsService from "@/services/service-requests";
import { PermanentError } from "@/saga/errors";

async function ensureAdmin() {
  // Papel admin E autenticador: o mesmo critério do layout do painel.
  if (!isAdmin(await getCurrentUser())) throw new Error("Não autorizado.");
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
  const parsed = parseProductForm(formData);
  if (!parsed.ok) return { errors: parsed.errors };
  const { values } = parsed;

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
  const parsed = parseProductForm(formData);
  if (!parsed.ok) return { errors: parsed.errors };
  const { values } = parsed;

  let productId: string;
  try {
    ({ productId } = await catalog.createProduct(db, values));
  } catch (error) {
    if (error instanceof PermanentError) return { message: error.message };
    throw error;
  }
  // Direto para a edição: é lá que ficam as fotos (galeria com envio).
  redirect(`/admin/produtos/${productId}`);
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
  const parsed = parseVariantForm(formData);
  if (!parsed.ok) return { errors: parsed.errors };
  const { values } = parsed;

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
  const parsed = parseVariantForm(formData);
  if (!parsed.ok) return { errors: parsed.errors };
  const { values } = parsed;

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
  const parsed = parseCouponForm(formData);
  if (!parsed.ok) return { errors: parsed.errors };
  const { values } = parsed;

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
  const parsed = parseCouponForm(formData);
  if (!parsed.ok) return { errors: parsed.errors };
  const { values } = parsed;

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

/**
 * Reprocessa da DLQ (painel de orquestração): uma mensagem (`messageId`) ou
 * tudo o que está parado naquela fila.
 */
export async function replayDeadLetter(queueName: string, messageId?: string): Promise<SimpleResult> {
  await ensureAdmin();
  if (!ALL_QUEUES.includes(queueName)) return { ok: false, error: "Fila desconhecida." };
  const replayed = await replayDeadLetters(queueName, messageId ? { messageId } : {});
  if (replayed === 0) return { ok: false, error: "Nada a reprocessar — a mensagem já saiu da DLQ." };
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

// ---------------------------------------------------------------- galeria

export type ImageFormState = { ok?: boolean; message?: string; sentAt?: number } | undefined;

// Id que chega do navegador (argumento ligado com .bind) não é confiável: vira
// pedaço do nome do arquivo e vai para o banco como uuid.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Envia uma foto para a galeria. O produto é conferido ANTES de gravar o
 * arquivo; se o banco falhar depois, o arquivo é apagado (sem órfão no Blob).
 */
export async function uploadProductImage(productId: string, _prev: ImageFormState, formData: FormData): Promise<ImageFormState> {
  await ensureAdmin();
  const storage = mediaStorageFromEnv();
  if (!storage) return { message: "Armazenamento de imagens não configurado. Crie o Blob store na Vercel (docs/DEPLOY.md)." };
  if (!UUID.test(productId)) return { message: "Produto não encontrado." };
  const product = await db.query.products.findFirst({ where: eq(products.id, productId), columns: { id: true } });
  if (!product) return { message: "Produto não encontrado." };
  // Antes de gravar o arquivo, para não subir foto que vai ser recusada. Quem
  // garante o limite sem corrida é o serviço (trava a linha do produto).
  if ((await catalog.listProductImages(db, productId)).length >= catalog.MAX_PRODUCT_IMAGES) {
    return { message: `Limite de ${catalog.MAX_PRODUCT_IMAGES} fotos por produto. Remova uma antes de enviar outra.` };
  }

  const file = formData.get("image");
  if (!(file instanceof File)) return { message: "Escolha uma imagem." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkImageUpload({ size: file.size, bytes });
  if (!check.ok) return { message: check.error };

  const key = `produtos/${productId}/${randomUUID()}.${check.type === "jpeg" ? "jpg" : check.type}`;
  const url = await storage.put(key, Buffer.from(bytes), IMAGE_CONTENT_TYPES[check.type]);
  try {
    await catalog.addProductImage(db, productId, { url, altText: String(formData.get("altText") ?? "") });
  } catch (error) {
    await storage.remove(url);
    if (error instanceof PermanentError) return { message: error.message };
    throw error;
  }
  refresh();
  return { ok: true, sentAt: Date.now() };
}

export async function saveProductImageAlt(imageId: string, _prev: ImageFormState, formData: FormData): Promise<ImageFormState> {
  await ensureAdmin();
  if (!UUID.test(imageId)) return { message: "Imagem não encontrada." };
  const saved = await catalog.updateProductImageAlt(db, imageId, String(formData.get("altText") ?? ""));
  if (!saved) return { message: "Imagem não encontrada." };
  refresh();
  return { ok: true };
}

export async function reorderProductImage(imageId: string, move: string): Promise<SimpleResult> {
  await ensureAdmin();
  if (!UUID.test(imageId) || (move !== "first" && move !== "up" && move !== "down")) {
    return { ok: false, error: "Pedido inválido." };
  }
  if (!(await catalog.moveProductImage(db, imageId, move))) return { ok: false, error: "Imagem não encontrada." };
  refresh();
  return { ok: true };
}

/** Tira da galeria e apaga o arquivo (se for enviado pelo painel; foto do catálogo fica no repositório). */
export async function deleteProductImage(imageId: string): Promise<SimpleResult> {
  await ensureAdmin();
  if (!UUID.test(imageId)) return { ok: false, error: "Imagem não encontrada." };
  const removed = await catalog.removeProductImage(db, imageId);
  if (!removed) return { ok: false, error: "Imagem não encontrada." };
  // Falha ao apagar o arquivo não desfaz a remoção: a foto já saiu da loja.
  await mediaStorageFromEnv()?.remove(removed.url).catch(() => undefined);
  refresh();
  return { ok: true };
}
