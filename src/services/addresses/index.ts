/**
 * Serviço de endereços — responsabilidade única: a agenda de endereços do
 * cliente.
 *
 * Detalhe que importa: `orders.shipping_address_id` tem FK com
 * `ON DELETE RESTRICT`, de propósito — endereço usado em pedido não pode
 * desaparecer, senão o histórico perde para onde a compra foi. Então
 * `deleteAddress` checa o uso antes e devolve um "não" explicável em vez de
 * estourar erro de FK na cara do usuário.
 */

import { and, desc, eq, or, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { addresses, orders } from "@/db/schema";
import { PermanentError } from "@/shared/errors";

export type AddressInput = {
  label: string;
  recipientName: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
};

export type AddressRow = typeof addresses.$inferSelect;

export async function listAddresses(executor: Executor, userId: string): Promise<AddressRow[]> {
  return executor.query.addresses.findMany({
    where: eq(addresses.userId, userId),
    orderBy: [desc(addresses.isDefault), desc(addresses.createdAt)],
  });
}

export async function getUserAddress(
  executor: Executor,
  userId: string,
  addressId: string,
): Promise<AddressRow | undefined> {
  return executor.query.addresses.findFirst({
    where: and(eq(addresses.id, addressId), eq(addresses.userId, userId)),
  });
}

export async function createAddress(
  executor: Executor,
  userId: string,
  input: AddressInput,
  options: { makeDefault?: boolean } = {},
): Promise<AddressRow> {
  const existing = await listAddresses(executor, userId);
  // O primeiro endereço da conta é o padrão automaticamente.
  const makeDefault = options.makeDefault ?? existing.length === 0;

  if (makeDefault && existing.length > 0) {
    await executor.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, userId));
  }

  const [created] = await executor
    .insert(addresses)
    .values({ userId, ...input, isDefault: makeDefault })
    .returning();

  return created;
}

export async function setDefaultAddress(
  executor: Executor,
  userId: string,
  addressId: string,
): Promise<{ changed: boolean }> {
  const address = await getUserAddress(executor, userId, addressId);
  if (!address) throw new PermanentError("address_not_found", "Endereço não encontrado.", { addressId });

  await executor.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, userId));
  await executor.update(addresses).set({ isDefault: true }).where(eq(addresses.id, addressId));

  return { changed: !address.isDefault };
}

/** Quantos pedidos apontam para este endereço (entrega ou cobrança). */
export async function addressUsageCount(executor: Executor, addressId: string): Promise<number> {
  const [row] = await executor
    .select({ total: sql<number>`count(*)::int` })
    .from(orders)
    .where(or(eq(orders.shippingAddressId, addressId), eq(orders.billingAddressId, addressId)));
  return row?.total ?? 0;
}

export async function deleteAddress(
  executor: Executor,
  userId: string,
  addressId: string,
): Promise<{ deleted: boolean }> {
  const address = await getUserAddress(executor, userId, addressId);
  if (!address) return { deleted: false };

  const usage = await addressUsageCount(executor, addressId);
  if (usage > 0) {
    throw new PermanentError(
      "address_in_use",
      "Este endereço está em um pedido e não pode ser removido.",
      { addressId, usage },
    );
  }

  await executor.delete(addresses).where(eq(addresses.id, addressId));

  // Se o padrão saiu, promove o mais recente que sobrou.
  if (address.isDefault) {
    const remaining = await listAddresses(executor, userId);
    if (remaining[0]) {
      await executor.update(addresses).set({ isDefault: true }).where(eq(addresses.id, remaining[0].id));
    }
  }

  return { deleted: true };
}
