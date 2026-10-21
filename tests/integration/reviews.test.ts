/**
 * Avaliações: uma por pessoa, compra verificada e agregado do produto.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, products, reviews } from "@/db/schema";
import { runSagaInline } from "@/saga/runner";
import {
  deleteReview,
  getUserReview,
  hasPurchasedProduct,
  ratingBreakdown,
  recalculateProductRating,
  upsertReview,
} from "@/services/reviews";
import { closeDatabase, resetDatabase, seedCheckoutFixture } from "../helpers/db";
import { startCheckout } from "../helpers/checkout";

beforeEach(resetDatabase);
after(closeDatabase);

async function productRow(productId: string) {
  return db.query.products.findFirst({ where: eq(products.id, productId) });
}

describe("avaliação", () => {
  it("grava a nota e atualiza média e contagem do produto", async () => {
    const fixture = await seedCheckoutFixture();

    await upsertReview(db, {
      productId: fixture.product.id,
      userId: fixture.userId,
      rating: 4,
      title: "Bom",
      comment: "Gostei",
    });

    const product = await productRow(fixture.product.id);
    assert.equal(product?.ratingCount, 1);
    assert.equal(Number(product?.ratingAverage), 4);
  });

  it("reenviar edita a própria avaliação em vez de criar outra", async () => {
    const fixture = await seedCheckoutFixture();
    const input = { productId: fixture.product.id, userId: fixture.userId, title: null, comment: null };

    await upsertReview(db, { ...input, rating: 2 });
    await upsertReview(db, { ...input, rating: 5, comment: "Mudei de opinião" });

    const rows = await db.query.reviews.findMany({ where: eq(reviews.productId, fixture.product.id) });
    assert.equal(rows.length, 1, "continua sendo uma avaliação");
    assert.equal(rows[0].rating, 5);
    assert.equal(rows[0].comment, "Mudei de opinião");

    const product = await productRow(fixture.product.id);
    assert.equal(product?.ratingCount, 1);
    assert.equal(Number(product?.ratingAverage), 5);
  });

  it("média é a dos usuários, arredondada a uma casa", async () => {
    const primeiro = await seedCheckoutFixture();
    const segundo = await seedCheckoutFixture();
    const terceiro = await seedCheckoutFixture();

    for (const [fixture, rating] of [
      [primeiro, 5],
      [segundo, 4],
      [terceiro, 4],
    ] as const) {
      await upsertReview(db, {
        productId: primeiro.product.id,
        userId: fixture.userId,
        rating,
        title: null,
        comment: null,
      });
    }

    const product = await productRow(primeiro.product.id);
    assert.equal(product?.ratingCount, 3);
    assert.equal(product?.ratingAverage, "4.3");
    assert.deepEqual(await ratingBreakdown(db, primeiro.product.id), { 1: 0, 2: 0, 3: 0, 4: 2, 5: 1 });
  });

  it("marca compra verificada só depois de um pedido pago", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1 });

    assert.equal(await hasPurchasedProduct(db, fixture.userId, fixture.product.id), false);

    const antes = await upsertReview(db, {
      productId: fixture.product.id,
      userId: fixture.userId,
      rating: 5,
      title: null,
      comment: null,
    });
    assert.equal(antes.isVerifiedPurchase, false);

    const checkout = await startCheckout(fixture);
    assert.equal((await runSagaInline(checkout.sagaId)).status, "completed");

    assert.equal(await hasPurchasedProduct(db, fixture.userId, fixture.product.id), true);
    const depois = await upsertReview(db, {
      productId: fixture.product.id,
      userId: fixture.userId,
      rating: 5,
      title: null,
      comment: null,
    });
    assert.equal(depois.isVerifiedPurchase, true, "reenviar depois da compra marca como verificada");
  });

  it("pedido cancelado não conta como compra", async () => {
    const fixture = await seedCheckoutFixture({ stock: 5, quantity: 1 });
    const checkout = await startCheckout(fixture, { simulate: "decline" });
    assert.equal((await runSagaInline(checkout.sagaId)).status, "compensated");

    const order = await db.query.orders.findFirst({ where: eq(orders.id, checkout.orderId) });
    assert.equal(order?.status, "cancelled");
    assert.equal(await hasPurchasedProduct(db, fixture.userId, fixture.product.id), false);
  });

  it("excluir devolve o agregado pro estado anterior", async () => {
    const primeiro = await seedCheckoutFixture();
    const segundo = await seedCheckoutFixture();

    await upsertReview(db, {
      productId: primeiro.product.id,
      userId: primeiro.userId,
      rating: 5,
      title: null,
      comment: null,
    });
    await upsertReview(db, {
      productId: primeiro.product.id,
      userId: segundo.userId,
      rating: 1,
      title: null,
      comment: null,
    });
    assert.equal((await productRow(primeiro.product.id))?.ratingAverage, "3.0");

    assert.deepEqual(await deleteReview(db, segundo.userId, primeiro.product.id), { deleted: true });
    const product = await productRow(primeiro.product.id);
    assert.equal(product?.ratingCount, 1);
    assert.equal(Number(product?.ratingAverage), 5);

    assert.deepEqual(
      await deleteReview(db, segundo.userId, primeiro.product.id),
      { deleted: false },
      "excluir o que não existe não é erro",
    );
  });

  it("produto sem avaliação volta pra média zero", async () => {
    const fixture = await seedCheckoutFixture();
    await upsertReview(db, {
      productId: fixture.product.id,
      userId: fixture.userId,
      rating: 3,
      title: null,
      comment: null,
    });
    await deleteReview(db, fixture.userId, fixture.product.id);

    const product = await productRow(fixture.product.id);
    assert.equal(product?.ratingCount, 0);
    assert.equal(Number(product?.ratingAverage), 0);
  });

  it("recalcular é idempotente", async () => {
    const fixture = await seedCheckoutFixture();
    await upsertReview(db, {
      productId: fixture.product.id,
      userId: fixture.userId,
      rating: 4,
      title: null,
      comment: null,
    });

    const primeira = await recalculateProductRating(db, fixture.product.id);
    const segunda = await recalculateProductRating(db, fixture.product.id);
    assert.deepEqual(primeira, segunda);
  });

  it("getUserReview devolve só a avaliação daquela pessoa", async () => {
    const dono = await seedCheckoutFixture();
    const outro = await seedCheckoutFixture();

    await upsertReview(db, {
      productId: dono.product.id,
      userId: dono.userId,
      rating: 2,
      title: "Minha",
      comment: null,
    });

    assert.equal((await getUserReview(db, dono.userId, dono.product.id))?.title, "Minha");
    assert.equal(await getUserReview(db, outro.userId, dono.product.id), undefined);
  });
});
