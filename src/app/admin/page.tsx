import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/data/auth";
import { getAdminStats, getAllOrders } from "@/lib/data/admin";
import { formatPriceCents } from "@/lib/format";
import { ORDER_STATUS_LABELS, orderStatusClass, type OrderStatus } from "@/lib/order-status";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminDashboard() {
  await requireAdmin();
  const [stats, recent] = await Promise.all([getAdminStats(), getAllOrders(6)]);

  const cards = [
    { label: "Receita total", value: formatPriceCents(stats.revenueCents) },
    { label: "Pedidos", value: String(stats.ordersCount) },
    { label: "Produtos ativos", value: String(stats.productsActive) },
    { label: "Estoque baixo", value: String(stats.lowStock), warn: stats.lowStock > 0 },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-border bg-background-elevated p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-foreground-muted">{c.label}</p>
            <p className={`mt-1.5 font-mono text-2xl font-bold tabular-nums ${c.warn ? "text-accent-secondary" : ""}`}>
              {c.value}
            </p>
          </div>
        ))}
      </div>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Pedidos recentes</h2>
          <Link href="/admin/pedidos" className="text-sm text-accent hover:underline">ver todos →</Link>
        </div>

        {recent.length === 0 ? (
          <p className="mt-4 text-sm text-foreground-muted">Nenhum pedido ainda.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-border bg-background-elevated text-left text-xs text-foreground-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Pedido</th>
                  <th className="px-4 py-2.5 font-medium">Cliente</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((o) => (
                  <tr key={o.id} className="border-b border-border last:border-0 hover:bg-background-elevated">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/pedidos/${o.orderNumber}`} className="font-mono text-xs font-semibold text-accent hover:underline">
                        {o.orderNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">{o.user.name}</td>
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
      </section>
    </div>
  );
}
