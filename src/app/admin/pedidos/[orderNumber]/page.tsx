import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/data/auth";
import { getAdminOrder } from "@/lib/data/admin";
import { OrderStatusForm } from "@/components/admin/OrderStatusForm";
import { SagaTimeline } from "@/components/SagaTimeline";
import { getSagaForOrder } from "@/lib/data/orchestration";
import { formatPriceCents } from "@/lib/format";
import { ORDER_STATUS_LABELS, orderStatusClass, type OrderStatus } from "@/lib/order-status";

export const metadata: Metadata = { title: "Pedido · Admin" };

const methodLabel: Record<string, string> = {
  pix: "Pix",
  credit_card: "Cartão",
  boleto: "Boleto",
  paypal: "PayPal",
};

export default async function AdminOrderDetail(props: PageProps<"/admin/pedidos/[orderNumber]">) {
  await requireAdmin();
  const { orderNumber } = await props.params;
  const order = await getAdminOrder(orderNumber);
  if (!order) notFound();

  const saga = await getSagaForOrder(orderNumber);
  const payment = order.payments[0];

  return (
    <div>
      <Link href="/admin/pedidos" className="text-sm text-foreground-muted hover:text-foreground">
        ← Pedidos
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="font-mono text-lg font-bold">{order.orderNumber}</h2>
          <span className={`label whitespace-nowrap px-2 py-0.5 ${orderStatusClass(order.status)}`}>
            {ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status}
          </span>
        </div>
        <span className="text-sm text-foreground-muted">
          {new Date(order.createdAt).toLocaleString("pt-BR")}
        </span>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-background-elevated p-4">
          <h3 className="label text-foreground-muted">Atualizar status</h3>
          <div className="mt-3">
            <OrderStatusForm orderId={order.id} current={order.status} />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-background-elevated p-4">
          <h3 className="label text-foreground-muted">
            Orquestração (saga)
          </h3>
          <div className="mt-3">
            {saga ? (
              <SagaTimeline
                showErrors
                steps={saga.steps.map((step) => ({
                  id: step.id,
                  name: step.name,
                  status: step.status,
                  attempts: step.attempts,
                  error: step.error,
                }))}
              />
            ) : (
              <p className="text-sm text-foreground-muted">
                Pedido anterior à orquestração (sem saga registrada).
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_18rem]">
        <div className="overflow-hidden rounded-xl border border-border">
          <ul className="divide-y divide-border">
            {order.items.map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="line-clamp-1">{it.productNameSnapshot}</span>
                  <span className="text-xs text-foreground-muted">{it.quantity} × {formatPriceCents(it.unitPriceCents)}</span>
                </span>
                <span className="font-mono tabular-nums">{formatPriceCents(it.totalCents)}</span>
              </li>
            ))}
          </ul>
          <dl className="flex flex-col gap-1.5 border-t border-border px-4 py-4 text-sm">
            <div className="flex justify-between"><dt className="text-foreground-muted">Subtotal</dt><dd className="font-mono tabular-nums">{formatPriceCents(order.subtotalCents)}</dd></div>
            {order.discountCents > 0 ? (
              <div className="flex justify-between">
                <dt className="text-foreground-muted">Desconto{order.coupon ? ` (${order.coupon.code})` : ""}</dt>
                <dd className="font-mono tabular-nums text-foreground">- {formatPriceCents(order.discountCents)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between"><dt className="text-foreground-muted">Frete</dt><dd className="font-mono tabular-nums">{order.shippingCents === 0 ? "Grátis" : formatPriceCents(order.shippingCents)}</dd></div>
            <div className="mt-1 flex justify-between border-t border-border pt-2 text-base font-semibold"><dt>Total</dt><dd className="font-mono tabular-nums text-accent">{formatPriceCents(order.totalCents)}</dd></div>
          </dl>
        </div>

        <aside className="flex flex-col gap-4 text-sm">
          <div className="rounded-xl border border-border p-4">
            <h3 className="label text-foreground-muted">Cliente</h3>
            <p className="mt-2 font-medium">{order.user.name}</p>
            <p className="text-foreground-muted">{order.user.email}</p>
          </div>
          <div className="rounded-xl border border-border p-4">
            <h3 className="label text-foreground-muted">Entrega</h3>
            <p className="mt-2 font-medium">{order.shippingAddress.recipientName}</p>
            <p className="text-foreground-muted">
              {order.shippingAddress.street}, {order.shippingAddress.number}
              {order.shippingAddress.complement ? ` · ${order.shippingAddress.complement}` : ""}
              <br />
              {order.shippingAddress.neighborhood} — {order.shippingAddress.city}/{order.shippingAddress.state}
              <br />
              CEP {order.shippingAddress.zipCode}
            </p>
          </div>
          <div className="rounded-xl border border-border p-4">
            <h3 className="label text-foreground-muted">Pagamento</h3>
            <p className="mt-2 font-medium">{payment ? methodLabel[payment.method] ?? payment.method : "—"}</p>
            <p className="text-foreground-muted">{payment ? `${payment.provider} · ${payment.status}` : ""}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
