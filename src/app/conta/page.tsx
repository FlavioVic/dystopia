import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/data/auth";
import { getUserOrders } from "@/lib/data/orders";
import { DeleteAccountForm } from "@/components/DeleteAccountForm";
import { logout } from "@/lib/actions/auth";
import { formatPriceCents } from "@/lib/format";
import { ORDER_STATUS_LABELS, orderStatusClass, type OrderStatus } from "@/lib/order-status";
import { PRIVATE_PAGE } from "@/lib/seo";

export const metadata: Metadata = { title: "Minha conta", robots: PRIVATE_PAGE };

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/entrar");

  const orders = await getUserOrders(user.id);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label text-foreground-muted">Ficha / {user.email}</p>
          <h1 className="display-2 mt-3 text-[26px] leading-[34px] sm:text-[32px] sm:leading-[40px]">{user.name}</h1>
          <p className="mt-2 text-sm text-foreground-muted">Seus dados, endereços e aquisições. Ficam guardados enquanto a conta existir.</p>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="rounded-md border border-border px-3.5 py-2 text-sm text-foreground-muted transition-colors hover:border-border-hover hover:text-foreground"
          >
            Encerrar sessão
          </button>
        </form>
      </div>

      <div className="mt-8 rounded-lg border border-border bg-background-elevated p-5">
        <h2 className="label text-foreground-muted">Dados</h2>
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
            <dt className="text-foreground-muted">Classe</dt>
            <dd className="font-medium">{user.role === "admin" ? "Comando" : "Cidadão"}</dd>
          </div>
        </dl>
      </div>

      <nav className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/favoritos"
          className="rounded-lg border border-border bg-background-elevated px-4 py-2.5 text-sm font-medium transition-colors hover:border-border-hover"
        >
          Arquivo de favoritos
        </Link>
        <Link
          href="/conta/enderecos"
          className="rounded-lg border border-border bg-background-elevated px-4 py-2.5 text-sm font-medium transition-colors hover:border-border-hover"
        >
          Endereços
        </Link>
        <Link
          href="/conta/seguranca"
          className="rounded-lg border border-border bg-background-elevated px-4 py-2.5 text-sm font-medium transition-colors hover:border-border-hover"
        >
          Segurança
        </Link>
      </nav>

      <section className="mt-8">
        <h2 className="label text-foreground-muted">Aquisições registradas</h2>
        {orders.length === 0 ? (
          <div className="mt-3 rounded-lg border border-border p-5 text-sm text-foreground-muted">
            Você ainda não fez pedidos.{" "}
            <Link href="/produtos" className="text-accent underline underline-offset-4">
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
                      className={`label whitespace-nowrap px-2 py-0.5 ${orderStatusClass(o.status)}`}
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
          href={user.mfaEnabled ? "/admin" : "/conta/seguranca"}
          className="mt-6 inline-flex items-center gap-2 rounded-lg border border-foreground bg-background-elevated px-4 py-2.5 text-sm font-semibold text-accent transition-colors hover:bg-background-elevated"
        >
          <span className="dys-label dys-label--restricted">Comando</span>
          {user.mfaEnabled ? "Abrir painel de gestão →" : "Cadastrar autenticador para abrir o painel →"}
        </Link>
      ) : null}
      <section className="mt-12 border-t border-border-faint pt-6" aria-labelledby="privacidade-titulo">
        <h2 id="privacidade-titulo" className="label text-foreground-muted">
          Privacidade
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-foreground-muted">
          Você pode baixar tudo o que a loja guarda sobre você ou excluir a conta. Detalhes na{" "}
          <Link href="/privacidade" className="text-foreground underline underline-offset-4">
            política de privacidade
          </Link>
          .
        </p>
        <div className="mt-4 flex flex-col items-start gap-4">
          <a href="/conta/dados" download className="label min-h-6 text-foreground underline underline-offset-4 hover:text-foreground-muted">
            Baixar meus dados (JSON)
          </a>
          {user.role === "admin" ? null : <DeleteAccountForm />}
        </div>
      </section>
    </div>
  );
}
