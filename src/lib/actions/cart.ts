"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { db } from "@/db";
import { limitAction } from "@/lib/action-limits";
import { CART_COOKIE } from "@/lib/data/cart";
import { getRequestIp } from "@/lib/request-ip";
import { PermanentError } from "@/saga/errors";
import * as cartsService from "@/services/carts";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 dias

export type CartActionResult = { ok: boolean; error?: string; count?: number };

/** Carrinho do cookie atual, se houver. */
async function currentCartId(): Promise<string | null> {
  const token = (await cookies()).get(CART_COOKIE)?.value;
  return token ? cartsService.findCartIdByToken(db, token) : null;
}

/** Carrinho do cookie atual ou um novo (setando o cookie). */
async function currentOrNewCartId(): Promise<string> {
  const existing = await currentCartId();
  if (existing) return existing;

  const token = crypto.randomUUID();
  const cartId = await cartsService.createGuestCart(db, token);
  (await cookies()).set(CART_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return cartId;
}

export async function addToCart(input: {
  productId: string;
  variantId?: string | null;
  quantity?: number;
}): Promise<CartActionResult> {
  // Por IP: sem cookie, cada chamada criaria um carrinho novo no banco.
  const limited = await limitAction("cart", `ip:${await getRequestIp()}`);
  if (limited) return { ok: false, error: limited };

  const cartId = await currentOrNewCartId();
  try {
    await cartsService.addItem(db, {
      cartId,
      productId: input.productId,
      variantId: input.variantId ?? null,
      quantity: input.quantity ?? 1,
    });
  } catch (error) {
    if (error instanceof PermanentError) return { ok: false, error: error.message };
    throw error;
  }
  refresh();
  return { ok: true, count: await cartsService.countItems(db, cartId) };
}

export async function updateCartItemQuantity(itemId: string, quantity: number): Promise<CartActionResult> {
  const cartId = await currentCartId();
  if (!cartId || !(await cartsService.setItemQuantity(db, { cartId, itemId, quantity }))) {
    return { ok: false, error: "Item não encontrado." };
  }
  refresh();
  return { ok: true, count: await cartsService.countItems(db, cartId) };
}

export async function removeCartItem(itemId: string): Promise<CartActionResult> {
  const cartId = await currentCartId();
  if (!cartId || !(await cartsService.removeItem(db, { cartId, itemId }))) {
    return { ok: false, error: "Item não encontrado." };
  }
  refresh();
  return { ok: true, count: await cartsService.countItems(db, cartId) };
}
