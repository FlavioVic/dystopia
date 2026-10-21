/**
 * Reconciliação manual: `npm run reconcile`.
 *
 * O worker já roda isso periodicamente; o script existe pra operação (depois
 * de um deploy que matou processos no meio, por exemplo) e pra inspeção.
 */

import "dotenv/config";
import { pgPool } from "@/db";
import { reconcile } from "@/saga/reconcile";

async function main(): Promise<void> {
  const report = await reconcile();
  console.log(JSON.stringify(report, null, 2));
  await pgPool.end();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
