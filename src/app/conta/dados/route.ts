import { exportAccountData } from "@/application/account-privacy";
import { getCurrentUser } from "@/lib/data/auth";

/**
 * Download dos dados da conta em JSON (LGPD, art. 18, II e V: acesso e
 * portabilidade). Quem é a pessoa sai do cookie de sessão, nunca da URL.
 */
export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Entre na sua conta." }, { status: 401 });

  const data = await exportAccountData(user.id);
  if (!data) return Response.json({ error: "Conta não encontrada." }, { status: 404 });

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="meus-dados-dystopia.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
