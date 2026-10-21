import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSession } from "@/lib/session";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: "customer" | "admin";
};

/**
 * Usuário logado (a partir do JWT da sessão) ou null. Memoizado por request
 * com React cache() — layout e páginas podem chamar sem duplicar a query.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getSession();
  if (!session) return null;
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
    columns: { id: true, name: true, email: true, role: true },
  });
  return user ?? null;
});

/** Exige um admin logado — redireciona pra /entrar caso contrário. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") redirect("/entrar");
  return user;
}
