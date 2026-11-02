import { cookies } from "next/headers";
import { db } from "@/db";
import { rememberDevice } from "@/services/known-devices";

/**
 * Cookie do aparelho conhecido (ver `services/known-devices`). Leva só um
 * token aleatório; não autentica — escolhe qual contador do limite de login
 * vale. Escrever cookie só funciona em Server Action, por isso mora aqui.
 */

export const KNOWN_DEVICE_COOKIE = "known_device";

export async function readKnownDeviceToken(): Promise<string | undefined> {
  return (await cookies()).get(KNOWN_DEVICE_COOKIE)?.value;
}

/** Login completo (senha e, se houver, o código): este navegador passa a ser conhecido. */
export async function rememberThisDevice(userId: string): Promise<void> {
  const store = await cookies();
  const { token, expiresAt } = await rememberDevice(db, {
    userId,
    currentToken: store.get(KNOWN_DEVICE_COOKIE)?.value,
  });
  store.set(KNOWN_DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}
