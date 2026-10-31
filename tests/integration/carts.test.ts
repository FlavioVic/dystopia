/**
 * Carrinho: as escritas que antes eram "lê, decide, escreve" na Server Action
 * e agora são uma instrução só no serviço. O que importa aqui é concorrência
 * de verdade (várias escritas ao mesmo tempo no mesmo banco) e posse.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cartItems, products } from "@/db/schema";
import { PermanentError } from "@/shared/errors";
import {
  addItem,
  countItems,
  createGuestCart,
  MAX_PER_ITEM,
  removeItem,
  restoreCart,
  setItemQuantity,
} from "@/services/carts";
import { closeDatabase, resetDatabase, seedCheckoutFixture } from "../helpers/db";

beforeEach(resetDatabase);
after(closeDatabase);

const lines = (cartId: string) => db.select().from(cartItems).where(eq(cartItems.cartId, cartId));

describe("carrinho — adicionar", () => {
  it("cliques simultâneos no mesmo produto somam numa linha só (sem variante)", async () => {
    const fixture = await seedCheckoutFixture({ stock: 50, quantity: 1 });
    const cartId = await createGuestCart(db, "visitante-a");

    await Promise.all(
      Array.from({ length: 6 }, () =>
        addItem(db, { cartId, productId: fixture.product.id, variantId: null, quantity: 1 }),
      ),
    );

    const rows = await lines(cartId);
    assert.equal(rows.length, 1, "variant_id NULL não duplica a linha");
    assert.equal(rows[0].quantity, 6, "nenhuma soma perdida");
  });

  it("o mesmo vale com variante", async () => {
    const fixture = await seedCheckoutFixture({ stock: 50, quantity: 1, withVariant: true, variantStock: 50 });
    const cartId = await createGuestCart(db, "visitante-b");

    await Promise.all(
      Array.from({ length: 4 }, () =>
        addItem(db, { cartId, productId: fixture.product.id, variantId: fixture.variantId, quantity: 2 }),
      ),
    );

    const rows = await lines(cartId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].quantity, 8);
  });

  it("respeita o estoque e o teto por item, mesmo somando", async () => {
    const fixture = await seedCheckoutFixture({ stock: 3, quantity: 1 });
    const cartId = await createGuestCart(db, "visitante-c");

    await addItem(db, { cartId, productId: fixture.product.id, variantId: null, quantity: 2 });
    await addItem(db, { cartId, productId: fixture.product.id, variantId: null, quantity: 2 });
    assert.equal((await lines(cartId))[0].quantity, 3, "limitado ao estoque");

    await db.update(products).set({ stockQuantity: 500 }).where(eq(products.id, fixture.product.id));
    for (let i = 0; i < 4; i += 1) {
      await addItem(db, { cartId, productId: fixture.product.id, variantId: null, quantity: 5 });
    }
    assert.equal((await lines(cartId))[0].quantity, MAX_PER_ITEM, "limitado ao teto");
  });

  it("produto inativo ou esgotado é erro de regra, não 500", async () => {
    const fixture = await seedCheckoutFixture({ stock: 0, quantity: 1 });
    const cartId = await createGuestCart(db, "visitante-d");

    await assert.rejects(
      addItem(db, { cartId, productId: fixture.product.id, variantId: null, quantity: 1 }),
      (error) => error instanceof PermanentError && error.code === "out_of_stock",
    );
    await db.update(products).set({ isActive: false, stockQuantity: 5 }).where(eq(products.id, fixture.product.id));
    await assert.rejects(
      addItem(db, { cartId, productId: fixture.product.id, variantId: null, quantity: 1 }),
      (error) => error instanceof PermanentError && error.code === "product_unavailable",
    );
  });
});

describe("carrinho — posse e quantidade", () => {
  it("item de outro carrinho não é alterado nem removido", async () => {
    const fixture = await seedCheckoutFixture({ stock: 10, quantity: 1 });
    const mine = await createGuestCart(db, "dono");
    const other = await createGuestCart(db, "intruso");
    await addItem(db, { cartId: mine, productId: fixture.product.id, variantId: null, quantity: 2 });
    const [item] = await lines(mine);

    assert.equal(await setItemQuantity(db, { cartId: other, itemId: item.id, quantity: 9 }), false);
    assert.equal(await removeItem(db, { cartId: other, itemId: item.id }), false);
    assert.equal((await lines(mine))[0].quantity, 2, "intocado");
  });

  it("quantidade 0 remove; contagem soma as unidades", async () => {
    const fixture = await seedCheckoutFixture({ stock: 10, quantity: 1 });
    const cartId = await createGuestCart(db, "visitante-e");
    await addItem(db, { cartId, productId: fixture.product.id, variantId: null, quantity: 3 });
    const [item] = await lines(cartId);

    assert.equal(await countItems(db, cartId), 3);
    assert.equal(await setItemQuantity(db, { cartId, itemId: item.id, quantity: 0 }), true);
    assert.deepEqual(await lines(cartId), []);
    assert.equal(await countItems(db, cartId), 0);
  });

  it("restaurar o carrinho duas vezes (compensação reentregue) não dobra os itens", async () => {
    const fixture = await seedCheckoutFixture({ stock: 10, quantity: 1 });
    const cartId = await createGuestCart(db, "visitante-f");
    const snapshot = [{ productId: fixture.product.id, variantId: null, quantity: 2, unitPriceCents: 1_000 }];

    await restoreCart(db, cartId, snapshot);
    await restoreCart(db, cartId, snapshot);
    const rows = await lines(cartId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].quantity, 2);
  });
});
