/**
 * Estoque sob concorrência: a regra "nunca vender sem estoque" é um UPDATE
 * condicional (`where stock >= qtd`). Aqui ela é testada com várias reservas
 * ao mesmo tempo, cada uma na sua transação — o que acontece num pico de
 * pedidos no último item.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { products, productVariants } from "@/db/schema";
import { PermanentError } from "@/saga/errors";
import { releaseStock, reserveStock } from "@/services/inventory";
import { closeDatabase, resetDatabase, seedCheckoutFixture } from "../helpers/db";

beforeEach(resetDatabase);
after(closeDatabase);

async function race(productId: string, variantId: string | null, attempts: number) {
  return Promise.allSettled(
    Array.from({ length: attempts }, () =>
      db.transaction((tx) => reserveStock(tx, [{ productId, variantId, quantity: 1 }])),
    ),
  );
}

describe("estoque concorrente", () => {
  it("10 reservas simultâneas com 3 em estoque: exatamente 3 passam, nunca negativo", async () => {
    const fixture = await seedCheckoutFixture({ stock: 3, quantity: 1 });
    const results = await race(fixture.product.id, null, 10);

    assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
    for (const r of results.filter((r): r is PromiseRejectedResult => r.status === "rejected")) {
      assert.ok(r.reason instanceof PermanentError, "falta de estoque é regra de negócio, não erro de banco");
    }
    const [row] = await db.select().from(products).where(eq(products.id, fixture.product.id));
    assert.equal(row.stockQuantity, 0);
  });

  it("o mesmo vale para o estoque da variante", async () => {
    const fixture = await seedCheckoutFixture({ stock: 50, quantity: 1, withVariant: true, variantStock: 2 });
    const results = await race(fixture.product.id, fixture.variantId, 6);

    assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
    const [variant] = await db.select().from(productVariants).where(eq(productVariants.id, fixture.variantId!));
    assert.equal(variant.stockQuantity, 0);
  });

  it("pedido com vários itens é tudo ou nada: falta de um desfaz os outros", async () => {
    const a = await seedCheckoutFixture({ stock: 5, quantity: 1 });
    const b = await seedCheckoutFixture({ stock: 1, quantity: 1 });

    await assert.rejects(
      db.transaction((tx) =>
        reserveStock(tx, [
          { productId: a.product.id, variantId: null, quantity: 2 },
          { productId: b.product.id, variantId: null, quantity: 3 },
        ]),
      ),
      PermanentError,
    );
    const [rowA] = await db.select().from(products).where(eq(products.id, a.product.id));
    assert.equal(rowA.stockQuantity, 5, "a reserva do primeiro item voltou junto com a transação");
  });

  it("devolver o estoque soma de volta", async () => {
    const fixture = await seedCheckoutFixture({ stock: 4, quantity: 1 });
    const line = { productId: fixture.product.id, variantId: null, quantity: 3 };
    await db.transaction((tx) => reserveStock(tx, [line]));
    await db.transaction((tx) => releaseStock(tx, [line]));
    const [row] = await db.select().from(products).where(eq(products.id, fixture.product.id));
    assert.equal(row.stockQuantity, 4);
  });
});
