import type { Metadata } from "next";
import { requireAdmin } from "@/lib/data/auth";
import { getCategoriesSimple } from "@/lib/data/admin";
import { ProductForm } from "@/components/admin/ProductForm";
import { createProduct } from "@/lib/actions/admin";

export const metadata: Metadata = { title: "Novo produto · Admin" };

export default async function NewProductPage() {
  await requireAdmin();
  const categories = await getCategoriesSimple();

  return (
    <div className="max-w-3xl">
      <h2 className="display-3 text-[20px] leading-[28px]">Novo produto</h2>
      <div className="mt-6">
        <ProductForm mode="create" action={createProduct} categories={categories} />
      </div>
    </div>
  );
}
