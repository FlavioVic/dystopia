/**
 * Galeria do produto contra o banco: a ordem é sempre 0..n-1 (0 = principal),
 * reordenar e remover não deixam buraco nem empate, e a descrição é limpa.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, beforeEach, describe, it } from "node:test";
import { db } from "@/db";
import { categories, products } from "@/db/schema";
import { PermanentError } from "@/shared/errors";
import {
  MAX_ALT_TEXT,
  MAX_PRODUCT_IMAGES,
  addProductImage,
  listProductImages,
  moveProductImage,
  removeProductImage,
  updateProductImageAlt,
} from "@/services/catalog";
import { closeDatabase, resetDatabase } from "../helpers/db";

beforeEach(resetDatabase);
after(closeDatabase);

async function createProduct(): Promise<string> {
  const [category] = await db.insert(categories).values({ name: "Refrigeração", slug: "refrigeracao" }).returning({ id: categories.id });
  const [product] = await db
    .insert(products)
    .values({ name: "Cooler", slug: "cooler", sku: "SKU-1", categoryId: category.id, priceCents: 19990, stockQuantity: 5, description: "x" })
    .returning({ id: products.id });
  return product.id;
}

const urls = async (productId: string) => (await listProductImages(db, productId)).map((i) => [i.url, i.position]);

describe("galeria do produto", () => {
  it("foto nova entra no fim; a primeira é a principal", async () => {
    const productId = await createProduct();
    await addProductImage(db, productId, { url: "/a.webp", altText: "A" });
    await addProductImage(db, productId, { url: "/b.webp" });
    await addProductImage(db, productId, { url: "/c.webp" });
    assert.deepEqual(await urls(productId), [["/a.webp", 0], ["/b.webp", 1], ["/c.webp", 2]]);
  });

  it("tornar principal, subir e descer reescrevem a ordem sem buraco", async () => {
    const productId = await createProduct();
    const a = await addProductImage(db, productId, { url: "/a.webp" });
    const b = await addProductImage(db, productId, { url: "/b.webp" });
    const c = await addProductImage(db, productId, { url: "/c.webp" });

    assert.equal(await moveProductImage(db, c.id, "first"), true);
    assert.deepEqual(await urls(productId), [["/c.webp", 0], ["/a.webp", 1], ["/b.webp", 2]]);
    await moveProductImage(db, b.id, "up");
    assert.deepEqual(await urls(productId), [["/c.webp", 0], ["/b.webp", 1], ["/a.webp", 2]]);
    await moveProductImage(db, c.id, "down");
    assert.deepEqual(await urls(productId), [["/b.webp", 0], ["/c.webp", 1], ["/a.webp", 2]]);
    // Nas pontas, não sai do lugar.
    await moveProductImage(db, b.id, "up");
    await moveProductImage(db, a.id, "down");
    assert.deepEqual(await urls(productId), [["/b.webp", 0], ["/c.webp", 1], ["/a.webp", 2]]);
  });

  it("remover devolve a URL (para apagar o arquivo) e fecha o buraco", async () => {
    const productId = await createProduct();
    const a = await addProductImage(db, productId, { url: "/a.webp" });
    await addProductImage(db, productId, { url: "/b.webp" });
    await addProductImage(db, productId, { url: "/c.webp" });

    assert.deepEqual(await removeProductImage(db, a.id), { url: "/a.webp" });
    assert.deepEqual(await urls(productId), [["/b.webp", 0], ["/c.webp", 1]]);
    assert.equal(await removeProductImage(db, a.id), null, "já removida");
  });

  it("descrição: aparada, cortada no limite, vazia vira nula", async () => {
    const productId = await createProduct();
    const image = await addProductImage(db, productId, { url: "/a.webp", altText: "  Cooler de frente  " });
    assert.equal(image.altText, "Cooler de frente");

    await updateProductImageAlt(db, image.id, "x".repeat(MAX_ALT_TEXT + 50));
    assert.equal((await listProductImages(db, productId))[0].altText?.length, MAX_ALT_TEXT);
    await updateProductImageAlt(db, image.id, "   ");
    assert.equal((await listProductImages(db, productId))[0].altText, null);
  });

  it(`até ${MAX_PRODUCT_IMAGES} fotos; a seguinte é recusada com mensagem para o admin`, async () => {
    const productId = await createProduct();
    for (let i = 0; i < MAX_PRODUCT_IMAGES; i += 1) await addProductImage(db, productId, { url: `/${i}.webp` });
    await assert.rejects(
      addProductImage(db, productId, { url: "/extra.webp" }),
      (error) => error instanceof PermanentError && error.code === "too_many_images" && /Remova uma/.test(error.message),
    );
    assert.equal((await listProductImages(db, productId)).length, MAX_PRODUCT_IMAGES);
  });

  it("dois envios ao mesmo tempo com uma vaga: só um entra", async () => {
    const productId = await createProduct();
    for (let i = 0; i < MAX_PRODUCT_IMAGES - 1; i += 1) await addProductImage(db, productId, { url: `/${i}.webp` });
    const results = await Promise.allSettled([
      addProductImage(db, productId, { url: "/x.webp" }),
      addProductImage(db, productId, { url: "/y.webp" }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await listProductImages(db, productId)).length, MAX_PRODUCT_IMAGES);
  });

  it("produto ou foto inexistente: erro de regra ou false, nunca 500", async () => {
    await assert.rejects(
      addProductImage(db, randomUUID(), { url: "/a.webp" }),
      (error) => error instanceof PermanentError && error.code === "product_not_found",
    );
    assert.equal(await moveProductImage(db, randomUUID(), "first"), false);
    assert.equal(await updateProductImageAlt(db, randomUUID(), "x"), false);
  });

  it("produto excluído leva as fotos junto", async () => {
    const productId = await createProduct();
    await addProductImage(db, productId, { url: "/a.webp" });
    await db.delete(products);
    assert.deepEqual(await listProductImages(db, productId), []);
  });
});
