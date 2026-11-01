import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/data/auth";
import { getCategoriesSimple, getProductForEdit } from "@/lib/data/admin";
import { ProductForm } from "@/components/admin/ProductForm";
import { ProductImages } from "@/components/admin/ProductImages";
import { VariantCreateForm } from "@/components/admin/VariantCreateForm";
import { VariantRow } from "@/components/admin/VariantRow";
import { createVariant, updateProduct, updateVariant, uploadProductImage } from "@/lib/actions/admin";
import { mediaStorageFromEnv } from "@/lib/media-storage";
import { MAX_PRODUCT_IMAGES } from "@/lib/product-media";

export const metadata: Metadata = { title: "Editar produto · Admin" };

export default async function EditProductPage(props: PageProps<"/admin/produtos/[id]">) {
  await requireAdmin();
  const { id } = await props.params;
  const [product, categories] = await Promise.all([getProductForEdit(id), getCategoriesSimple()]);
  if (!product) notFound();

  const action = updateProduct.bind(null, id);

  return (
    <div className="max-w-3xl">
      <h2 className="display-3 text-[20px] leading-[28px]">Editar produto</h2>
      <p className="mt-1 text-sm text-foreground-muted">{product.name}</p>
      <div className="mt-6">
        <ProductForm
          mode="edit"
          action={action}
          categories={categories}
          defaults={{
            name: product.name,
            slug: product.slug,
            sku: product.sku,
            brand: product.brand,
            categoryId: product.categoryId,
            price: (product.priceCents / 100).toFixed(2),
            compareAt: product.compareAtPriceCents ? (product.compareAtPriceCents / 100).toFixed(2) : "",
            stock: String(product.stockQuantity),
            description: product.description,
            isActive: product.isActive,
            isFeatured: product.isFeatured,
          }}
        />
      </div>

      <section className="mt-10 border-t border-border pt-6" aria-labelledby="imagens-titulo">
        <h3 id="imagens-titulo" className="label text-foreground-muted">
          Imagens ({product.images.length}/{MAX_PRODUCT_IMAGES})
        </h3>
        <p className="mt-1 text-xs text-foreground-muted">
          A primeira é a principal: aparece no card da loja e no topo da página do produto. Até{" "}
          {MAX_PRODUCT_IMAGES} fotos; na loja, o cliente vê todas.
        </p>
        <div className="mt-4">
          <ProductImages
            images={product.images.map((image) => ({ id: image.id, url: image.url, altText: image.altText }))}
            uploadAction={uploadProductImage.bind(null, id)}
            storageReady={mediaStorageFromEnv() !== null}
            full={product.images.length >= MAX_PRODUCT_IMAGES}
          />
        </div>
      </section>

      <section className="mt-10 border-t border-border pt-6">
        <h3 className="label text-foreground-muted">
          Variantes ({product.variants.length})
        </h3>
        <p className="mt-1 text-xs text-foreground-muted">
          Variante com preço vazio herda o preço do produto. O estoque da variante é o que a saga
          reserva na compra.
        </p>

        {product.variants.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-2.5">
            {product.variants.map((variant) => (
              <VariantRow
                key={variant.id}
                variantId={variant.id}
                variant={{
                  name: variant.name,
                  sku: variant.sku,
                  priceCents: variant.priceCents,
                  stockQuantity: variant.stockQuantity,
                  attributes: variant.attributes,
                }}
                action={updateVariant.bind(null, variant.id)}
              />
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-foreground-muted">
            Sem variantes — o produto é vendido como item único.
          </p>
        )}

        <div className="mt-4">
          <VariantCreateForm action={createVariant.bind(null, id)} />
        </div>
      </section>
    </div>
  );
}
