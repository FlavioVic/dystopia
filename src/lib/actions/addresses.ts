"use server";

/**
 * Server Actions da agenda de endereços. Tudo escopado ao usuário da sessão —
 * nenhuma action aceita "id do dono" vindo do cliente.
 */

import { refresh } from "next/cache";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/data/auth";
import { parseAddressForm } from "@/lib/validation/address";
import { PermanentError } from "@/saga/errors";
import { createAddress, deleteAddress, setDefaultAddress } from "@/services/addresses";

export type AddressState =
  | { errors?: Record<string, string>; message?: string; ok?: boolean }
  | undefined;

export type AddressActionResult = { ok: boolean; error?: string };

export async function saveAddress(_prev: AddressState, formData: FormData): Promise<AddressState> {
  const user = await getCurrentUser();
  if (!user) return { message: "Entre na sua conta." };

  const parsed = parseAddressForm(formData);
  if (!parsed.ok) return { errors: parsed.errors };
  const { values } = parsed;

  await createAddress(db, user.id, values, {
    makeDefault: formData.get("isDefault") != null ? true : undefined,
  });

  refresh();
  return { ok: true, message: "Endereço salvo." };
}

export async function makeDefaultAddress(addressId: string): Promise<AddressActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autorizado." };

  try {
    await setDefaultAddress(db, user.id, addressId);
  } catch (error) {
    if (error instanceof PermanentError) return { ok: false, error: error.message };
    throw error;
  }

  refresh();
  return { ok: true };
}

export async function removeAddress(addressId: string): Promise<AddressActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autorizado." };

  try {
    const { deleted } = await deleteAddress(db, user.id, addressId);
    if (!deleted) return { ok: false, error: "Endereço não encontrado." };
  } catch (error) {
    // Endereço preso em pedido: a FK é RESTRICT de propósito, então a resposta
    // é uma explicação, não um 500.
    if (error instanceof PermanentError) return { ok: false, error: error.message };
    throw error;
  }

  refresh();
  return { ok: true };
}
