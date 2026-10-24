import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { requireAdmin } from "@/lib/data/auth";
import { getAllProductsAdmin } from "@/lib/data/admin";
import { ProductFlags } from "@/components/admin/ProductFlags";
import { formatPriceCents } from "@/lib/format";

export const metadata: Metadata = { title: "Produtos · Admin" };

export default async function AdminProducts() {
  await requireAdmin();
  const products = await getAllProductsAdmin();

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="label text-foreground-muted">
          Produtos ({products.length})
        </h2>
        <Link
          href="/admin/produtos/novo"
          className="rounded-lg bg-primary px-4 py-2 label text-primary-foreground"
        >
          + Novo produto
        </Link>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-border bg-background-elevated text-left text-xs text-foreground-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Produto</th>
              <th className="px-4 py-2.5 font-medium">Categoria</th>
              <th className="px-4 py-2.5 text-right font-medium">Preço</th>
              <th className="px-4 py-2.5 text-right font-medium">Estoque</th>
              <th className="px-4 py-2.5 font-medium">Situação</th>
              <th className="px-4 py-2.5 text-right font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const img = p.images[0];
              return (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-background-elevated">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md border border-border bg-background">
                        {img ? <Image src={img.url} alt="" fill sizes="40px" className="object-cover" /> : null}
                      </span>
                      <span className="line-clamp-1 font-medium">{p.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-foreground-muted">{p.category?.name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatPriceCents(p.priceCents)}</td>
                  <td className={`px-4 py-2.5 text-right font-mono tabular-nums ${p.stockQuantity <= 3 ? "text-foreground-muted" : ""}`}>
                    {p.stockQuantity}
                  </td>
                  <td className="px-4 py-2.5">
                    <ProductFlags id={p.id} isActive={p.isActive} isFeatured={p.isFeatured} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link href={`/admin/produtos/${p.id}`} className="text-sm font-medium text-accent hover:underline">
                      Editar
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
