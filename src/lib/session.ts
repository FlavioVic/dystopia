import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

/**
 * Sessão stateless: um JWT assinado (HS256) guardado num cookie httpOnly.
 * Payload mínimo (userId + role) — sem dados sensíveis. Estratégia recomendada
 * pelos docs do Next; não precisa de tabela de sessões no banco.
 */

const SESSION_COOKIE = "session";
const MAX_AGE_S = 60 * 60 * 24 * 7; // 7 dias

export type SessionPayload = {
  userId: string;
  role: "customer" | "admin";
};

const secret = process.env.SESSION_SECRET;
if (!secret) {
  throw new Error("SESSION_SECRET não está definida. Veja .env.example.");
}
const encodedKey = new TextEncoder().encode(secret);

/** Token assinado da sessão. Puro (sem cookie) — exportado para os testes. */
export async function signSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(encodedKey);
}

/** Sessão do token, ou `null` se inválido, adulterado, expirado ou com papel desconhecido. */
export async function verifySessionToken(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encodedKey, { algorithms: ["HS256"] });
    if (typeof payload.userId === "string" && (payload.role === "customer" || payload.role === "admin")) {
      return { userId: payload.userId, role: payload.role };
    }
    return null;
  } catch {
    return null;
  }
}

/** Cria a sessão e seta o cookie (usar só em Server Action / Route Handler). */
export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await signSessionToken(payload);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

/** Lê e valida a sessão atual (ou null). Seguro em Server Components. */
export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}

/** Remove a sessão (logout). Usar só em Server Action / Route Handler. */
export async function deleteSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
