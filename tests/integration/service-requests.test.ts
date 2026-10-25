/**
 * Pedidos de orçamento: gravação com protocolo único e andamento pelo admin.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications, outbox, serviceRequests } from "@/db/schema";
import { sendServiceRequestAlert } from "@/services/notifications";
import { PermanentError } from "@/saga/errors";
import {
  createServiceRequest,
  listServiceRequests,
  updateServiceRequestStatus,
} from "@/services/service-requests";
import { closeDatabase, resetDatabase } from "../helpers/db";

beforeEach(resetDatabase);
after(closeDatabase);

const input = {
  kind: "manutencao" as const,
  name: "Ana Souza",
  email: "ana@exemplo.com",
  phone: null,
  details: "Computador desligando sozinho sob carga.",
};

describe("pedidos de orçamento", () => {
  it("grava como novo, com protocolo", async () => {
    const row = await createServiceRequest(db, input);
    assert.match(row.protocol, /^DYS-S\d{6}$/);
    assert.equal(row.status, "novo");
    assert.equal((await listServiceRequests(db)).length, 1);
  });

  it("protocolo repetido é sorteado de novo, sem perder o pedido", async () => {
    const draws = [7, 7, 8];
    const random = () => draws.shift() ?? 9;
    const first = await createServiceRequest(db, input, { random });
    const second = await createServiceRequest(db, input, { random });
    assert.equal(first.protocol, "DYS-S000007");
    assert.equal(second.protocol, "DYS-S000008");
  });

  it("o admin muda o andamento; status fora da lista é recusado", async () => {
    const row = await createServiceRequest(db, input);
    const updated = await updateServiceRequestStatus(db, row.id, "em_contato");
    assert.equal(updated.status, "em_contato");
    assert.equal((await listServiceRequests(db, { status: "novo" })).length, 0);

    await assert.rejects(() => updateServiceRequestStatus(db, row.id, "apagado"), PermanentError);
    await assert.rejects(
      () => updateServiceRequestStatus(db, "00000000-0000-0000-0000-000000000000", "fechado"),
      PermanentError,
    );
  });

  it("dentro de transação, protocolo repetido usa savepoint e o retry funciona", async () => {
    const draws = [3, 3, 4];
    const random = () => draws.shift() ?? 9;
    await createServiceRequest(db, input, { random });
    const second = await db.transaction((tx) => createServiceRequest(tx, input, { random }));
    assert.equal(second.protocol, "DYS-S000004");
  });

  it("pedido e alerta na mesma transação: o alerta entra na fila uma vez só", async () => {
    await db.transaction(async (tx) => {
      const row = await createServiceRequest(tx, input);
      const alert = { recipient: "responsavel@exemplo.dev", protocol: row.protocol, serviceName: "Manutenção", name: row.name, email: row.email, phone: null, details: row.details };
      assert.equal((await sendServiceRequestAlert(tx, alert)).duplicate, false);
      assert.equal((await sendServiceRequestAlert(tx, alert)).duplicate, true);
    });
    const [n] = await db.select().from(notifications);
    assert.match(n.subject, /^Orçamento DYS-S\d{6}: Manutenção$/);
    assert.equal(n.recipient, "responsavel@exemplo.dev");
    assert.equal((await db.select().from(outbox).where(eq(outbox.type, "notifications.deliver"))).length, 1);
  });

  it("se a transação desfaz, não sobra pedido nem alerta", async () => {
    await assert.rejects(() =>
      db.transaction(async (tx) => {
        const row = await createServiceRequest(tx, input);
        await sendServiceRequestAlert(tx, { recipient: "r@exemplo.dev", protocol: row.protocol, serviceName: "Manutenção", name: row.name, email: row.email, phone: null, details: row.details });
        throw new Error("falha depois de gravar");
      }),
    );
    assert.equal((await db.select().from(serviceRequests)).length, 0);
    assert.equal((await db.select().from(notifications)).length, 0);
  });
});
