import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/data/auth";
import { getAllOrders } from "@/lib/data/admin";
import { formatPriceCents } from "@/lib/format";
import { ORDER_STATUS_LABELS, orderStatusClass, type OrderStatus } from "@/lib/order-status";

export const metadata: Metadata = { title: "Pedidos · Admin" };

export default async function AdminOrders() {
  await requireAdmin();
  const orders = await getAllOrders();

  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">
        Pedidos ({orders.length})
      </h2>

      {orders.length === 0 ? (
        <p className="mt-4 text-sm text-foreground-muted">Nenhum pedido ainda.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-border">
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
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${orderStatusClass(o.status)}`}>
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
    </div>
  );
}
