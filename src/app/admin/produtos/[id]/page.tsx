import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/data/auth";
import { getCategoriesSimple, getProductForEdit } from "@/lib/data/admin";
import { ProductForm } from "@/components/admin/ProductForm";
import { updateProduct } from "@/lib/actions/admin";

export const metadata: Metadata = { title: "Editar produto · Admin" };

export default async function EditProductPage(props: PageProps<"/admin/produtos/[id]">) {
  await requireAdmin();
  const { id } = await props.params;
  const [product, categories] = await Promise.all([getProductForEdit(id), getCategoriesSimple()]);
  if (!product) notFound();

  const action = updateProduct.bind(null, id);

  return (
    <div className="max-w-3xl">
      <h2 className="font-brand text-xl font-bold uppercase tracking-tight">Editar produto</h2>
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
    </div>
  );
}
