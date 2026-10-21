/**
 * Registro de handlers da fila: tipo de job → função que executa.
 *
 * Um handler pode cuidar do destino do próprio job (é o caso de
 * `saga.advance`, que precisa reagendar com backoff conforme o resultado da
 * saga). Nesse caso ele retorna `{ settled: true }` e o worker não mexe mais.
 */

import { reconcile } from "@/saga/reconcile";
import { handleSagaAdvanceJob, SAGA_ADVANCE_JOB, SAGA_RECONCILE_JOB } from "@/saga/runner";
import type { ClaimedJob } from "./index";

export type JobResult = { settled: boolean };
export type JobHandler = (job: ClaimedJob) => Promise<JobResult>;

export const handlers: Record<string, JobHandler> = {
  [SAGA_ADVANCE_JOB]: async (job) => {
    await handleSagaAdvanceJob(job);
    return { settled: true };
  },
  [SAGA_RECONCILE_JOB]: async () => {
    await reconcile();
    return { settled: false };
  },
};

export function getHandler(type: string): JobHandler | undefined {
  return handlers[type];
}
