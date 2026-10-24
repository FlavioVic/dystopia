import { timingSafeEqual } from "node:crypto";
import { runInlineWorker } from "@/composition/worker";

/**
 * Cron de segurança do worker embutido (`vercel.json` › crons): reconcilia,
 * drena a fila e faz a faxina que o worker de pé faria. Pega o que nenhum
 * request empurrou — retry agendado pra depois do fim do request, job de um
 * executor que morreu.
 *
 * A Vercel manda `Authorization: Bearer $CRON_SECRET`. Sem o segredo
 * configurado a rota fica fechada: é endpoint público.
 */

export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const report = await runInlineWorker({ budgetMs: 50_000, waitForScheduled: true, reconcile: true, housekeeping: true });
  return Response.json(report);
}
