"use server";

/**
 * Exclusão da própria conta (LGPD, art. 18, VI). Pede a senha de novo: sessão
 * esquecida aberta num computador alheio não basta para apagar a conta.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { deleteAccount } from "@/lib/account-privacy";
import { limitAction } from "@/lib/action-limits";
import { CART_COOKIE } from "@/lib/data/cart";
import { getCurrentUser } from "@/lib/data/auth";
import { endSession } from "@/lib/session";
import { PermanentError } from "@/saga/errors";
import { verifyCredentials } from "@/services/accounts";

export type DeleteAccountState = { message?: string } | undefined;

export async function deleteMyAccount(_prev: DeleteAccountState, formData: FormData): Promise<DeleteAccountState> {
  const user = await getCurrentUser();
  if (!user) redirect("/entrar");

  const limited = await limitAction("accountDelete", `user:${user.id}`);
  if (limited) return { message: limited };

  const password = String(formData.get("password") ?? "");
  const account = password ? await verifyCredentials(db, { email: user.email, password }) : null;
  if (!account || account.id !== user.id) return { message: "Senha incorreta." };

  try {
    await db.transaction((tx) => deleteAccount(tx, user.id));
  } catch (error) {
    if (error instanceof PermanentError) return { message: error.message };
    throw error;
  }

  await endSession();
  (await cookies()).delete(CART_COOKIE);
  redirect("/?conta=excluida");
}
