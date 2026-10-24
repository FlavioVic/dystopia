import { after } from "next/server";
import { runInlineWorker, type InlineRunOptions } from "@/composition/worker";

/**
 * Worker embutido (`INLINE_WORKER=1`): no deploy só-Vercel não há processo de
 * fila de pé, então quem deixa trabalho na fila drena ela depois de responder
 * (`after`). Sem a flag — dev, ou deploy com o worker em container — não faz
 * nada: o `npm run worker` é quem cuida.
 *
 * Vários drenos ao mesmo tempo são seguros: `claim()` usa SKIP LOCKED e a saga
 * tem lease, então cada job/passo roda uma vez só.
 */
export function inlineWorkerEnabled(): boolean {
  return process.env.INLINE_WORKER === "1";
}

export function drainQueueAfterResponse(options: InlineRunOptions): void {
  if (!inlineWorkerEnabled()) return;
  after(() => runInlineWorker(options));
}
