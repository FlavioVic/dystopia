import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { SagaTimeline } from "@/components/SagaTimeline";
import { getCurrentUser } from "@/lib/data/auth";
import { getOrderByNumber } from "@/lib/data/orders";
import { formatPriceCents } from "@/lib/format";
import { getSagaByCorrelationId } from "@/saga/orchestrator";

export const metadata: Metadata = { title: "Pedido" };

const methodLabel: Record<string, string> = {
  pix: "Pix",
  credit_card: "Cartão de crédito",
  boleto: "Boleto",
  paypal: "PayPal",
};

const paymentStatusLabel: Record<string, string> = {
  pending: "Aguardando",
  authorized: "Autorizado",
  paid: "Aprovado",
  failed: "Não aprovado",
  refunded: "Estornado",
};

// Quem processou: deixa claro que nada foi cobrado de verdade.
const providerLabel: Record<string, string> = {
  stripe: "Stripe, modo de teste",
  simulado: "simulado",
};

/**
 * Página do pedido. O pedido nasce `pending` e a SAGA o leva pra `paid` (ou
 * `cancelled`, compensando tudo). Então esta página tem três estados — e,
 * enquanto a saga roda, ela se atualiza sozinha.
 */
export default async function OrderPage(props: PageProps<"/pedido/[orderNumber]">) {
  const { orderNumber } = await props.params;
  const user = await getCurrentUser();
  if (!user) redirect("/entrar");

  const order = await getOrderByNumber(orderNumber, user.id);
  if (!order) notFound();

  const saga = await getSagaByCorrelationId(orderNumber);
  const payment = order.payments[0];

  const state =
    order.status === "pending" ? "processing" : order.status === "cancelled" ? "failed" : "confirmed";

  const header = {
    confirmed: {
      title: "Pedido confirmado!",
      badge: "Pago",
      badgeClass: "bg-deal-soft text-success",
      iconClass: "bg-deal-soft text-success",
      icon: <path d="M5 12.5l4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />,
      description: (
        <>
          Obrigado, {user.name.split(" ")[0]}. Seu pedido{" "}
          <span className="font-mono font-semibold text-foreground">{order.orderNumber}</span> foi recebido.
        </>
      ),
    },
    processing: {
      title: "Processando pedido",
      badge: "Em processamento",
      badgeClass: "bg-accent/10 text-accent",
      iconClass: "bg-accent/10 text-accent",
      icon: <path d="M12 6v6l4 2" strokeLinecap="round" strokeLinejoin="round" />,
      description: (
        <>
          Estamos confirmando o pagamento do pedido{" "}
          <span className="font-mono font-semibold text-foreground">{order.orderNumber}</span>. Esta página
          atualiza sozinha.
        </>
      ),
    },
    failed: {
      title: "Pedido não concluído",
      badge: "Cancelado",
      badgeClass: "bg-danger/10 text-danger",
      iconClass: "bg-danger/10 text-danger",
      icon: <path d="M7 7l10 10M17 7L7 17" strokeLinecap="round" strokeLinejoin="round" />,
      description: (
        <>
          O pedido <span className="font-mono font-semibold text-foreground">{order.orderNumber}</span> foi
          cancelado e tudo que já havia sido aplicado foi desfeito — estoque, cupom e cobrança.
        </>
      ),
    },
  }[state];

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      {/* Todo pedido passa por aqui: o pagamento é remoto e responde em ~1–2 s.
          Intervalo curto pra não somar 3 s de espera a cada compra; 60 ticks
          mantém a mesma janela de 1 min antes de parar. */}
      {state === "processing" ? <AutoRefresh intervalMs={1_000} maxTicks={60} /> : null}

      <div className="flex flex-col items-center text-center">
        <div className={`flex h-16 w-16 items-center justify-center rounded-full ${header.iconClass}`}>
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2.2">
            {header.icon}
          </svg>
        </div>
        <h1 className="mt-5 font-brand text-2xl font-bold uppercase tracking-tight">{header.title}</h1>
        <p className="mt-2 text-sm text-foreground-muted">{header.description}</p>
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-background-elevated">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background-elevated-hover px-5 py-3 text-xs">
          <span className="font-mono font-semibold">{order.orderNumber}</span>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold ${header.badgeClass}`}>
            {header.badge}
          </span>
        </div>

        <ul className="divide-y divide-border px-5">
          {order.items.map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <span className="min-w-0">
                <span className="line-clamp-1">{it.productNameSnapshot}</span>
                <span className="text-xs text-foreground-muted">
                  {it.quantity} × {formatPriceCents(it.unitPriceCents)}
                </span>
              </span>
              <span className="font-mono tabular-nums">{formatPriceCents(it.totalCents)}</span>
            </li>
          ))}
        </ul>

        <dl className="flex flex-col gap-2 border-t border-border px-5 py-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-foreground-muted">Subtotal</dt>
            <dd className="font-mono tabular-nums">{formatPriceCents(order.subtotalCents)}</dd>
          </div>
          {order.discountCents > 0 ? (
            <div className="flex justify-between">
              <dt className="text-foreground-muted">
                Desconto{order.coupon ? ` (${order.coupon.code})` : ""}
              </dt>
              <dd className="font-mono font-semibold tabular-nums text-success">
                - {formatPriceCents(order.discountCents)}
              </dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-foreground-muted">Frete</dt>
            <dd className="font-mono tabular-nums">
              {order.shippingCents === 0 ? "Grátis" : formatPriceCents(order.shippingCents)}
            </dd>
          </div>
          <div className="mt-1 flex items-baseline justify-between border-t border-border pt-3 text-base font-semibold">
            <dt>Total</dt>
            <dd className="font-mono tabular-nums text-accent">{formatPriceCents(order.totalCents)}</dd>
          </div>
        </dl>
      </div>

      {saga ? (
        <div className="mt-4 rounded-xl border border-border p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            Andamento do pedido
          </h2>
          <div className="mt-3">
            <SagaTimeline
              steps={saga.steps.map((step) => ({
                id: step.id,
                name: step.name,
                status: step.status,
                attempts: step.attempts,
                error: null,
              }))}
            />
          </div>
          {state === "failed" && saga.lastError ? (
            <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {customerReason(saga.lastError)}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border p-4 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Entrega</h2>
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
        <div className="rounded-xl border border-border p-4 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Pagamento</h2>
          {/* Sem linha de pagamento: ou a saga ainda não chegou lá, ou a
              autorização foi recusada (a transação do passo não commita nada). */}
          <p className="mt-2 font-medium">
            {payment ? methodLabel[payment.method] ?? payment.method : state === "failed" ? "Nenhuma cobrança" : "—"}
          </p>
          <p className="text-foreground-muted">
            {payment
              ? `${paymentStatusLabel[payment.status] ?? payment.status} (${providerLabel[payment.provider] ?? payment.provider})`
              : state === "failed"
                ? "Nada foi debitado"
                : "Aguardando confirmação"}
          </p>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/produtos" className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground">
          Continuar comprando
        </Link>
        <Link href="/conta" className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium hover:border-border-hover">
          Meus pedidos
        </Link>
      </div>
    </div>
  );
}

/** `sagas.last_error` guarda "codigo: detalhe técnico" — o cliente só vê a parte dele. */
function customerReason(lastError: string): string {
  const [code] = lastError.split(":");
  switch (code.trim()) {
    case "out_of_stock":
      return "Um item do pedido ficou sem estoque antes da confirmação.";
    case "payment_declined":
      return "O pagamento foi recusado pela operadora.";
    case "coupon_exhausted":
      return "O cupom usado esgotou antes da confirmação.";
    default:
      return "Não foi possível concluir o pedido. Nenhuma cobrança ficou em aberto.";
  }
}
