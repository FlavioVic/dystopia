import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { buttonPrimary, buttonSecondary } from "@/components/Kit";
import { SagaTimeline } from "@/components/SagaTimeline";
import { getCurrentUser } from "@/lib/data/auth";
import { getOrderByNumber } from "@/lib/data/orders";
import { drainQueueAfterResponse } from "@/lib/inline-worker";
import { formatPriceCents } from "@/lib/format";
import { getSagaByCorrelationId } from "@/saga/orchestrator";
import { PRIVATE_PAGE } from "@/lib/seo";

export const metadata: Metadata = { title: "Pedido", robots: PRIVATE_PAGE };
export const maxDuration = 30;

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
 * Página do pedido. O pedido nasce `pending` e a SAGA o leva para `paid` (ou
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
  // Rede de segurança do worker embutido: se o dreno do checkout morreu no
  // meio, cada atualização desta página empurra a fila mais um pouco.
  if (state === "processing") drainQueueAfterResponse({ budgetMs: 10_000 });

  // Voz da marca: declarativa, sem exclamação. O estado vai em palavra no rótulo.
  const header = {
    confirmed: {
      title: "Aquisição registrada.",
      badge: "Pago",
      badgeClass: "dys-label--classified",
      description: "O pagamento foi aprovado e o equipamento está reservado. O despacho segue o protocolo.",
    },
    processing: {
      title: "Processando aquisição.",
      badge: "Em processamento",
      badgeClass: "",
      description: "O pagamento está em verificação. Esta página se atualiza sozinha.",
    },
    failed: {
      title: "Aquisição não concluída.",
      badge: "Cancelado",
      badgeClass: "dys-label--restricted",
      description: "O pedido foi cancelado. Tudo o que havia sido aplicado foi desfeito: estoque, cupom e cobrança.",
    },
  }[state];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      {/* Todo pedido passa por aqui: o pagamento é remoto e responde em ~1–2 s.
          Intervalo curto para não somar 3 s de espera a cada compra; 60 ticks
          mantém a mesma janela de 1 min antes de parar. */}
      {state === "processing" ? <AutoRefresh intervalMs={1_000} maxTicks={60} /> : null}

      <p className="label text-foreground-muted">Pedido / {order.orderNumber}</p>
      <h1 className="display-2 mt-4 text-[26px] leading-[34px] sm:text-[40px] sm:leading-[48px]">{header.title}</h1>
      <p className="mt-4 max-w-xl text-base leading-relaxed text-foreground-muted">{header.description}</p>

      <div className="mt-10 border border-border-faint bg-background-elevated">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-faint px-5 py-3 text-xs">
          <span className="font-mono font-semibold">{order.orderNumber}</span>
          <span className={`dys-label ${header.badgeClass}`}>{header.badge}</span>
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
              <dd className="font-mono font-semibold tabular-nums text-foreground">
                - {formatPriceCents(order.discountCents)}
              </dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-foreground-muted">Frete</dt>
            <dd className="font-mono tabular-nums">
              {order.shippingCents === 0 ? "Sem custo" : formatPriceCents(order.shippingCents)}
            </dd>
          </div>
          <div className="mt-1 flex items-baseline justify-between border-t border-border pt-3 text-base font-semibold">
            <dt>Total</dt>
            <dd className="font-mono tabular-nums text-accent">{formatPriceCents(order.totalCents)}</dd>
          </div>
        </dl>
      </div>

      {saga ? (
        <div className="mt-4 border border-border-faint p-5">
          <h2 className="label text-foreground-muted">
            Protocolo de processamento
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
            <p className="mt-3 bg-signal px-4 py-3 text-sm text-on-signal">
              {customerReason(saga.lastError)}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="border border-border-faint p-5 text-sm">
          <h2 className="label text-foreground-muted">Entrega</h2>
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
        <div className="border border-border-faint p-5 text-sm">
          <h2 className="label text-foreground-muted">Pagamento</h2>
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

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/produtos" className={buttonPrimary}>
          Voltar ao inventário
        </Link>
        <Link href="/conta" className={buttonSecondary}>
          Minha ficha
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
