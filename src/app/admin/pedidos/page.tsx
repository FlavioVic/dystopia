import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pagination } from "@/components/Pagination";
import { requireAdmin } from "@/lib/data/auth";
import { listOrders } from "@/lib/data/admin";
import { ADMIN_PAGE_SIZE, isPastLastPage, parsePage } from "@/lib/pagination";
import { formatPriceCents } from "@/lib/format";
import { ORDER_STATUS_LABELS, orderStatusClass, type OrderStatus } from "@/lib/order-status";

export const metadata: Metadata = { title: "Pedidos · Admin" };

export default async function AdminOrders(props: PageProps<"/admin/pedidos">) {
  await requireAdmin();
  const page = parsePage((await props.searchParams).pagina, ADMIN_PAGE_SIZE);
  const { items: orders, total } = await listOrders(page);
  if (isPastLastPage(page.page, total, ADMIN_PAGE_SIZE)) notFound();

  return (
    <div>
      <h2 className="label text-foreground-muted">
        Pedidos ({total})
      </h2>

      {orders.length === 0 ? (
        <p className="mt-4 text-sm text-foreground-muted">Nenhum pedido ainda.</p>
      ) : (
        <div tabIndex={0} role="region" aria-label="Pedidos" className="mt-4 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-border bg-background-elevated text-left text-xs text-foreground-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Pedido</th>
                <th className="px-4 py-2.5 font-medium">Cliente</th>
                <th className="px-4 py-2.5 font-medium">Data</th>
                <th className="px-4 py-2.5 font-medium">Itens</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-border last:border-0 hover:bg-background-elevated">
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/pedidos/${o.orderNumber}`} className="font-mono text-xs font-semibold text-accent hover:underline">
                      {o.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="block">{o.user.name}</span>
                    <span className="text-xs text-foreground-muted">{o.user.email}</span>
                  </td>
                  <td className="px-4 py-2.5 text-foreground-muted">
                    {new Date(o.createdAt).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{o.items.length}</td>
                  <td className="px-4 py-2.5">
                    <span className={`label whitespace-nowrap px-2 py-0.5 ${orderStatusClass(o.status)}`}>
                      {ORDER_STATUS_LABELS[o.status as OrderStatus] ?? o.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatPriceCents(o.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination basePath="/admin/pedidos" page={page.page} total={total} pageSize={ADMIN_PAGE_SIZE} />
    </div>
  );
}
