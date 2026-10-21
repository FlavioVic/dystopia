import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/data/auth";
import { getUserOrders } from "@/lib/data/orders";
import { logout } from "@/lib/actions/auth";
import { formatPriceCents } from "@/lib/format";
import { ORDER_STATUS_LABELS, orderStatusClass, type OrderStatus } from "@/lib/order-status";

export const metadata: Metadata = { title: "Minha conta" };

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/entrar");

  const orders = await getUserOrders(user.id);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Olá, {user.name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-foreground-muted">Gerencie sua conta e seus pedidos.</p>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="rounded-md border border-border px-3.5 py-2 text-sm text-foreground-muted transition-colors hover:border-border-hover hover:text-foreground"
          >
            Sair
          </button>
        </form>
      </div>

      <div className="mt-8 rounded-lg border border-border bg-background-elevated p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Dados</h2>
        <dl className="mt-4 flex flex-col gap-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-foreground-muted">Nome</dt>
            <dd className="font-medium">{user.name}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-foreground-muted">E-mail</dt>
            <dd className="font-medium">{user.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-foreground-muted">Tipo de conta</dt>
            <dd className="font-medium">{user.role === "admin" ? "Administrador" : "Cliente"}</dd>
          </div>
        </dl>
      </div>

      <nav className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/favoritos"
          className="rounded-lg border border-border bg-background-elevated px-4 py-2.5 text-sm font-medium transition-colors hover:border-border-hover"
        >
          ♥ Favoritos
        </Link>
        <Link
          href="/conta/enderecos"
          className="rounded-lg border border-border bg-background-elevated px-4 py-2.5 text-sm font-medium transition-colors hover:border-border-hover"
        >
          Endereços
        </Link>
      </nav>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Meus pedidos</h2>
        {orders.length === 0 ? (
          <div className="mt-3 rounded-lg border border-border p-5 text-sm text-foreground-muted">
            Você ainda não fez pedidos.{" "}
            <Link href="/produtos" className="text-accent hover:underline">
              Explorar produtos
            </Link>
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {orders.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/pedido/${o.orderNumber}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background-elevated px-4 py-3 transition-colors hover:border-border-hover"
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-sm font-semibold">{o.orderNumber}</span>
                    <span className="text-xs text-foreground-muted">
                      {new Date(o.createdAt).toLocaleDateString("pt-BR")} ·{" "}
                      {o.items.length} {o.items.length === 1 ? "item" : "itens"}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${orderStatusClass(o.status)}`}
                    >
                      {ORDER_STATUS_LABELS[o.status as OrderStatus] ?? o.status}
                    </span>
                    <span className="font-mono text-sm font-semibold tabular-nums">
                      {formatPriceCents(o.totalCents)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {user.role === "admin" ? (
        <Link
          href="/admin"
          className="mt-6 inline-flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-4 py-2.5 text-sm font-semibold text-accent transition-colors hover:bg-accent/10"
        >
          <span className="rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] text-accent-foreground">ADMIN</span>
          Abrir painel de gestão →
        </Link>
      ) : null}
    </div>
  );
}
