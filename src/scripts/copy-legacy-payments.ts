/**
 * Migração de produção, uma vez: os pagamentos que ficaram na tabela antiga
 * (banco da loja) vão para o banco de pagamentos. `npm run payments:copy-legacy`.
 *
 * Idempotente (mesmo id e mesma chave de idempotência: o que já foi copiado
 * fica como está), então dá para rodar antes do merge e de novo depois —
 * pega o que o código antigo gravou no meio do caminho. De quebra, preenche o
 * resumo de pagamento dos pedidos que ainda não têm (a migration 0014 já fez
 * isso para o que existia quando ela rodou).
 *
 * Roda com a conexão do DONO dos dois bancos (`DATABASE_URL` e
 * `PAYMENTS_DATABASE_URL`). A tabela antiga só sai numa limpeza depois, com
 * a contagem conferida.
 */

import "dotenv/config";
import { and, eq, isNull } from "drizzle-orm";
import { db, pgPool } from "@/db";
import { legacyPayments, orders } from "@/db/schema";
import { paymentsDb, paymentsPool } from "@/services/payments/db";
import { payments } from "@/services/payments/schema";

async function main(): Promise<void> {
  const rows = await db.select().from(legacyPayments);

  let copied = 0;
  for (const row of rows) {
    const inserted = await paymentsDb
      .insert(payments)
      .values({
        id: row.id,
        orderId: row.orderId,
        provider: row.provider,
        method: row.method,
        status: row.status,
        amountCents: row.amountCents,
        transactionId: row.transactionId,
        idempotencyKey: row.idempotencyKey,
        paidAt: row.paidAt,
        createdAt: row.createdAt,
      })
      .onConflictDoNothing()
      .returning({ id: payments.id });
    copied += inserted.length;

    const summarized = await db
      .update(orders)
      .set({
        paymentMethod: row.method,
        paymentStatus: row.status,
        paymentProvider: row.provider,
        paymentTransactionId: row.transactionId,
        paidAt: row.paidAt,
      })
      .where(and(eq(orders.id, row.orderId), isNull(orders.paymentMethod)))
      .returning({ id: orders.id });
    if (summarized.length > 0) console.log(`resumo preenchido no pedido ${row.orderId}`);
  }

  const total = await paymentsDb.$count(payments);
  console.log(`✅ ${rows.length} pagamento(s) na tabela antiga; ${copied} copiado(s) agora; ${total} no banco de pagamentos.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pgPool.end();
    await paymentsPool.end();
  });
