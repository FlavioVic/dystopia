/**
 * Lista de desejos: idempotência, toggle e leitura por usuário.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";
import {
  addToWishlist,
  isInWishlist,
  listWishlist,
  removeFromWishlist,
  toggleWishlist,
  wishlistProductIds,
} from "@/services/wishlist";
import { closeDatabase, resetDatabase, seedCheckoutFixture } from "../helpers/db";

beforeEach(resetDatabase);
after(closeDatabase);

describe("favoritos", () => {
  it("favoritar duas vezes não duplica linha", async () => {
    const fixture = await seedCheckoutFixture();

    assert.deepEqual(await addToWishlist(db, fixture.userId, fixture.product.id), { added: true });
    assert.deepEqual(
      await addToWishlist(db, fixture.userId, fixture.product.id),
      { added: false },
      "a chave primária composta já garante isso",
    );
    assert.equal((await db.query.wishlistItems.findMany()).length, 1);
  });

  it("toggle alterna e devolve o estado final", async () => {
    const fixture = await seedCheckoutFixture();

    assert.deepEqual(await toggleWishlist(db, fixture.userId, fixture.product.id), { inWishlist: true });
    assert.equal(await isInWishlist(db, fixture.userId, fixture.product.id), true);

    assert.deepEqual(await toggleWishlist(db, fixture.userId, fixture.product.id), { inWishlist: false });
    assert.equal(await isInWishlist(db, fixture.userId, fixture.product.id), false);
    assert.equal((await db.query.wishlistItems.findMany()).length, 0);
  });

  it("remover o que não está salvo não é erro", async () => {
    const fixture = await seedCheckoutFixture();
    assert.deepEqual(await removeFromWishlist(db, fixture.userId, fixture.product.id), { removed: false });
  });

  it("cada pessoa vê só os próprios favoritos", async () => {
    const ana = await seedCheckoutFixture();
    const bruno = await seedCheckoutFixture();

    await addToWishlist(db, ana.userId, ana.product.id);
    await addToWishlist(db, ana.userId, bruno.product.id);
    await addToWishlist(db, bruno.userId, bruno.product.id);

    const daAna = await wishlistProductIds(db, ana.userId);
    assert.equal(daAna.length, 2);
    assert.ok(daAna.includes(ana.product.id) && daAna.includes(bruno.product.id));

    assert.deepEqual(await wishlistProductIds(db, bruno.userId), [bruno.product.id]);
  });

  it("a lista vem com produto e imagens, do mais novo para o mais antigo", async () => {
    const fixture = await seedCheckoutFixture();
    const outro = await seedCheckoutFixture();

    await addToWishlist(db, fixture.userId, fixture.product.id);
    await addToWishlist(db, fixture.userId, outro.product.id);

    const list = await listWishlist(db, fixture.userId);
    assert.equal(list.length, 2);
    assert.equal(list[0].productId, outro.product.id, "mais recente primeiro");
    assert.ok(list[0].product.name.length > 0, "traz o produto junto");
    assert.ok(Array.isArray(list[0].product.images));
  });

  it("apagar o produto limpa o favorito (cascade no banco)", async () => {
    const fixture = await seedCheckoutFixture();
    await addToWishlist(db, fixture.userId, fixture.product.id);

    await db.delete(products).where(eq(products.id, fixture.product.id));

    assert.equal((await db.query.wishlistItems.findMany()).length, 0);
  });

  it("produto desativado some da lista, mas o favorito fica para quando ele voltar", async () => {
    const fixture = await seedCheckoutFixture();
    await addToWishlist(db, fixture.userId, fixture.product.id);

    await db.update(products).set({ isActive: false }).where(eq(products.id, fixture.product.id));
    assert.deepEqual(await listWishlist(db, fixture.userId), []);
    assert.deepEqual(await wishlistProductIds(db, fixture.userId), [], "o contador do cabeçalho bate com a lista");
    assert.equal((await db.query.wishlistItems.findMany()).length, 1, "o favorito continua gravado");

    await db.update(products).set({ isActive: true }).where(eq(products.id, fixture.product.id));
    assert.equal((await listWishlist(db, fixture.userId)).length, 1);
    assert.deepEqual(await wishlistProductIds(db, fixture.userId), [fixture.product.id]);
  });
});
