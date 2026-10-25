/**
 * Sincroniza só a MÍDIA do catálogo (imagens e vitrine) com o código:
 * `npm run catalog:media`.
 *
 * Existe para produção: o seed faz TRUNCATE em tudo (contas, pedidos, senha de
 * admin); isto só reescreve `product_images` e `is_featured` dos produtos do
 * catálogo, casando por slug. Idempotente.
 */

import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { db, pgPool } from "@/db";
import { productImages, products } from "@/db/schema";
import { SEED_PRODUCTS } from "@/db/seed-catalog";
import { PRODUCT_PHOTOS } from "@/lib/photo-credits";

async function main(): Promise<void> {
  const rows = await db
    .select({ id: products.id, slug: products.slug, name: products.name })
    .from(products)
    .where(inArray(products.slug, SEED_PRODUCTS.map((p) => p.slug)));

  for (const row of rows) {
    const photo = PRODUCT_PHOTOS[row.slug];
    const plate = `/images/products/${row.slug}.svg`;
    await db.transaction(async (tx) => {
      await tx.delete(productImages).where(eq(productImages.productId, row.id));
      await tx.insert(productImages).values(
        photo
          ? [
              { productId: row.id, url: photo.file, altText: `${row.name} — foto`, position: 0 },
              { productId: row.id, url: plate, altText: `${row.name} — ficha técnica`, position: 1 },
            ]
          : [{ productId: row.id, url: plate, altText: row.name, position: 0 }],
      );
      await tx.update(products).set({ isFeatured: Boolean(photo) }).where(eq(products.id, row.id));
    });
  }
  console.log(`mídia sincronizada: ${rows.length} produtos, ${Object.keys(PRODUCT_PHOTOS).length} com foto`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pgPool.end());
