/**
 * Serviço de catálogo: produto (unicidade de slug/SKU, flags) e variantes.
 */

import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { productImages, productVariants, products } from "@/db/schema";
import { getProductBySlug } from "@/lib/data/products";
import { PermanentError } from "@/shared/errors";
import {
  createProduct,
  createVariant,
  deleteVariant,
  listVariants,
  setProductFlag,
  updateProduct,
  updateVariant,
} from "@/services/catalog";
import { closeDatabase, resetDatabase, seedCheckoutFixture } from "../helpers/db";

beforeEach(resetDatabase);
after(closeDatabase);

function productInput(categoryId: string, overrides: Record<string, unknown> = {}) {
  return {
    name: "Caneca Cyberpunk",
    slug: "caneca-cyberpunk",
    description: "Caneca de cerâmica",
    brand: "Dystopia Labs",
    sku: "SKU-CANECA",
    categoryId,
    priceCents: 7_990,
    compareAtPriceCents: 11_990,
    stockQuantity: 10,
    isActive: true,
    isFeatured: false,
    ...overrides,
  };
}

const variantInput = {
  name: "M / Preto",
  sku: "SKU-M-PRETO",
  priceCents: null,
  stockQuantity: 5,
  attributes: { Tamanho: "M", Cor: "Preto" },
};

describe("produto", () => {
  it("cria com imagem opcional", async () => {
    const fixture = await seedCheckoutFixture();
    const { productId } = await createProduct(db, productInput(fixture.categoryId), {
      imageUrl: "/images/products/caneca.jpg",
    });

    const product = await db.query.products.findFirst({ where: eq(products.id, productId) });
    assert.equal(product?.slug, "caneca-cyberpunk");
    assert.equal(product?.priceCents, 7_990);

    const images = await db.query.productImages.findMany({
      where: eq(productImages.productId, productId),
    });
    assert.equal(images.length, 1);
    assert.equal(images[0].altText, "Caneca Cyberpunk");
  });

  it("recusa slug e SKU repetidos com erro explicável", async () => {
    const fixture = await seedCheckoutFixture();
    await createProduct(db, productInput(fixture.categoryId));

    await assert.rejects(
      () => createProduct(db, productInput(fixture.categoryId, { sku: "OUTRO-SKU" })),
      (error: unknown) => error instanceof PermanentError && error.code === "duplicate_slug",
    );
    await assert.rejects(
      () => createProduct(db, productInput(fixture.categoryId, { slug: "outro-slug" })),
      (error: unknown) => error instanceof PermanentError && error.code === "duplicate_sku",
    );
    assert.equal((await db.query.products.findMany()).length, 2, "só o da fixture e o criado");
  });

  it("editar mantendo o próprio slug funciona", async () => {
    const fixture = await seedCheckoutFixture();
    const { productId } = await createProduct(db, productInput(fixture.categoryId));

    await updateProduct(db, productId, productInput(fixture.categoryId, { name: "Caneca Nova" }));
    const product = await db.query.products.findFirst({ where: eq(products.id, productId) });
    assert.equal(product?.name, "Caneca Nova");
    assert.equal(product?.slug, "caneca-cyberpunk");
  });

  it("editar pegando o slug de outro produto é recusado", async () => {
    const fixture = await seedCheckoutFixture();
    const primeiro = await createProduct(db, productInput(fixture.categoryId));
    const segundo = await createProduct(
      db,
      productInput(fixture.categoryId, { slug: "outro", sku: "SKU-OUTRO" }),
    );

    await assert.rejects(
      () =>
        updateProduct(
          db,
          segundo.productId,
          productInput(fixture.categoryId, { slug: "caneca-cyberpunk", sku: "SKU-OUTRO" }),
        ),
      (error: unknown) => error instanceof PermanentError && error.code === "duplicate_slug",
    );
    assert.ok(primeiro.productId);
  });

  it("alterna as flags e avisa quando o produto não existe", async () => {
    const fixture = await seedCheckoutFixture();

    assert.deepEqual(await setProductFlag(db, fixture.product.id, "isFeatured"), { value: true });
    assert.deepEqual(await setProductFlag(db, fixture.product.id, "isFeatured"), { value: false });
    assert.deepEqual(await setProductFlag(db, fixture.product.id, "isActive"), { value: false });

    await assert.rejects(
      () => setProductFlag(db, "00000000-0000-0000-0000-000000000000", "isActive"),
      (error: unknown) => error instanceof PermanentError && error.code === "product_not_found",
    );
  });
});

describe("variantes", () => {
  it("cria, lista e edita", async () => {
    const fixture = await seedCheckoutFixture();
    const { variantId } = await createVariant(db, fixture.product.id, variantInput);

    const list = await listVariants(db, fixture.product.id);
    assert.equal(list.length, 1);
    assert.deepEqual(list[0].attributes, { Tamanho: "M", Cor: "Preto" });
    assert.equal(list[0].priceCents, null, "herda o preço do produto");

    await updateVariant(db, variantId, { ...variantInput, stockQuantity: 2, priceCents: 4_990 });
    const updated = await db.query.productVariants.findFirst({
      where: eq(productVariants.id, variantId),
    });
    assert.equal(updated?.stockQuantity, 2);
    assert.equal(updated?.priceCents, 4_990);
  });

  it("SKU de variante é único", async () => {
    const fixture = await seedCheckoutFixture();
    await createVariant(db, fixture.product.id, variantInput);

    await assert.rejects(
      () => createVariant(db, fixture.product.id, { ...variantInput, name: "G / Preto" }),
      (error: unknown) => error instanceof PermanentError && error.code === "duplicate_variant_sku",
    );
  });

  it("editar mantendo o próprio SKU funciona", async () => {
    const fixture = await seedCheckoutFixture();
    const { variantId } = await createVariant(db, fixture.product.id, variantInput);
    await updateVariant(db, variantId, { ...variantInput, name: "M / Preto (novo)" });

    const variant = await db.query.productVariants.findFirst({
      where: eq(productVariants.id, variantId),
    });
    assert.equal(variant?.name, "M / Preto (novo)");
  });

  it("recusa variante em produto inexistente e edição de variante inexistente", async () => {
    await assert.rejects(
      () => createVariant(db, "00000000-0000-0000-0000-000000000000", variantInput),
      (error: unknown) => error instanceof PermanentError && error.code === "product_not_found",
    );
    await assert.rejects(
      () => updateVariant(db, "00000000-0000-0000-0000-000000000000", variantInput),
      (error: unknown) => error instanceof PermanentError && error.code === "variant_not_found",
    );
  });

  it("remove e avisa quando não existe", async () => {
    const fixture = await seedCheckoutFixture();
    const { variantId } = await createVariant(db, fixture.product.id, variantInput);

    assert.deepEqual(await deleteVariant(db, variantId), { deleted: true });
    assert.equal((await listVariants(db, fixture.product.id)).length, 0);
    assert.deepEqual(await deleteVariant(db, variantId), { deleted: false });
  });
});

describe("página do produto", () => {
  it("produto desativado no painel não abre pela URL (a página dá 404)", async () => {
    const fixture = await seedCheckoutFixture();
    const product = await db.query.products.findFirst({ where: eq(products.id, fixture.product.id) });
    assert.ok(await getProductBySlug(product!.slug), "ativo abre");

    await db.update(products).set({ isActive: false }).where(eq(products.id, fixture.product.id));
    // `cache()` do React só memoriza dentro de um request; aqui cada chamada consulta.
    assert.equal(await getProductBySlug(product!.slug), undefined);
  });
});
