/**
 * Casos de uso dos direitos do titular (LGPD, art. 18) que o site atende
 * sozinho: baixar os próprios dados (acesso e portabilidade) e excluir a
 * conta (eliminação).
 *
 * Moram na aplicação, não em `services/`, porque cruzam vários donos (pedido,
 * saga, e-mail, avaliação, orçamento).
 *
 * A exclusão apaga, não anonimiza: a loja é demonstração (nenhuma venda real,
 * nenhuma nota fiscal a guardar), então não há obrigação legal que justifique
 * manter pedido de quem pediu para sair. Vai junto o que carrega dado pessoal
 * fora da tabela de usuários: e-mails enviados (destinatário e corpo), saga do
 * pedido (payload com endereço) e pedidos de orçamento (nome, e-mail, telefone).
 */

import { eq, inArray, like, or } from "drizzle-orm";
import { db, type Executor } from "@/db";
import {
  addresses,
  notifications,
  orders,
  rateLimits,
  reviews,
  sagas,
  serviceRequests,
  sessions,
  users,
  wishlistItems,
} from "@/db/schema";
import { PermanentError } from "@/shared/errors";
import { recalculateProductRating } from "@/services/reviews";

export async function exportAccountData(userId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { name: true, email: true, role: true, createdAt: true },
  });
  if (!user) return null;

  const [userAddresses, userOrders, userReviews, wishlist, requests, logins] = await Promise.all([
    db.query.addresses.findMany({
      where: eq(addresses.userId, userId),
      columns: { id: false, userId: false },
    }),
    db.query.orders.findMany({
      where: eq(orders.userId, userId),
      columns: {
        orderNumber: true,
        status: true,
        subtotalCents: true,
        shippingCents: true,
        discountCents: true,
        totalCents: true,
        createdAt: true,
        // O resumo do pagamento que o pedido guarda; a cobrança em si é do serviço de pagamentos.
        paymentMethod: true,
        paymentStatus: true,
        paymentProvider: true,
        paidAt: true,
      },
      with: {
        items: { columns: { productNameSnapshot: true, quantity: true, unitPriceCents: true, totalCents: true } },
      },
    }),
    db.query.reviews.findMany({
      where: eq(reviews.userId, userId),
      columns: { rating: true, title: true, comment: true, createdAt: true },
      with: { product: { columns: { name: true } } },
    }),
    db.query.wishlistItems.findMany({
      where: eq(wishlistItems.userId, userId),
      columns: { createdAt: true },
      with: { product: { columns: { name: true } } },
    }),
    db.query.serviceRequests.findMany({
      where: or(eq(serviceRequests.userId, userId), eq(serviceRequests.email, user.email)),
      columns: { protocol: true, kind: true, name: true, email: true, phone: true, details: true, status: true, createdAt: true },
    }),
    // Só quando entrou e até quando vale: o hash do token não é dado da pessoa e não sai daqui.
    db.query.sessions.findMany({
      where: eq(sessions.userId, userId),
      columns: { createdAt: true, expiresAt: true },
    }),
  ]);

  return {
    geradoEm: new Date().toISOString(),
    conta: user,
    enderecos: userAddresses,
    pedidos: userOrders,
    avaliacoes: userReviews,
    favoritos: wishlist,
    orcamentos: requests,
    sessoes: logins,
  };
}

/**
 * Apaga a conta e tudo que é dela, numa transação só. Admin não se exclui (o
 * painel ficaria sem dono).
 */
export async function deleteAccount(userId: string): Promise<{ deleted: boolean }> {
  return db.transaction((tx) => deleteAccountData(tx, userId));
}

async function deleteAccountData(executor: Executor, userId: string): Promise<{ deleted: boolean }> {
  const user = await executor.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, email: true, role: true },
  });
  if (!user) return { deleted: false };
  if (user.role === "admin") {
    throw new PermanentError("admin_account", "Conta de administrador não pode ser excluída por aqui.");
  }

  const userOrders = await executor
    .select({ id: orders.id, orderNumber: orders.orderNumber })
    .from(orders)
    .where(eq(orders.userId, userId));
  const requests = await executor
    .select({ id: serviceRequests.id, protocol: serviceRequests.protocol })
    .from(serviceRequests)
    .where(or(eq(serviceRequests.userId, userId), eq(serviceRequests.email, user.email)));

  const correlations = [...userOrders.map((o) => o.orderNumber), ...requests.map((r) => r.protocol)];
  if (correlations.length > 0) await executor.delete(notifications).where(inArray(notifications.correlationId, correlations));
  // E-mail sem correlação (ex.: enviado antes de existir pedido) ainda é dele.
  await executor.delete(notifications).where(eq(notifications.recipient, user.email));

  if (userOrders.length > 0) {
    await executor.delete(sagas).where(inArray(sagas.correlationId, userOrders.map((o) => o.orderNumber)));
    // Itens e eventos caem em cascata. A cobrança fica no banco de
    // pagamentos: registro financeiro sem dado pessoal (valor, meio, id da
    // transação) — o vínculo com a pessoa some junto com o pedido.
    await executor.delete(orders).where(inArray(orders.id, userOrders.map((o) => o.id)));
  }
  if (requests.length > 0) await executor.delete(serviceRequests).where(inArray(serviceRequests.id, requests.map((r) => r.id)));

  // Avaliação some em cascata com o usuário, mas a média do produto não: recalcula.
  const reviewed = await executor.select({ productId: reviews.productId }).from(reviews).where(eq(reviews.userId, userId));
  await executor.delete(reviews).where(eq(reviews.userId, userId));
  for (const { productId } of reviewed) await recalculateProductRating(executor, productId);

  await executor.delete(rateLimits).where(like(rateLimits.key, `%:user:${userId}`));
  // Endereços, carrinho e favoritos caem em cascata.
  await executor.delete(users).where(eq(users.id, userId));
  return { deleted: true };
}
