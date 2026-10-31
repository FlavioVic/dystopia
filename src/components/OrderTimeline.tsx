import { describeCancellation } from "@/lib/order-status";

export type OrderTimelineEvent = {
  id: string;
  type: string;
  data: unknown;
  occurredAt: Date;
};

const EVENT_LABELS: Record<string, string> = {
  placed: "Pedido recebido",
  paid: "Pagamento aprovado",
  processing: "Em separação",
  shipped: "Despachado",
  delivered: "Entregue",
  cancelled: "Pedido cancelado",
  refunded: "Valor reembolsado",
};

function reasonOf(data: unknown): string | null {
  const reason = data && typeof data === "object" ? (data as Record<string, unknown>).reason : null;
  return typeof reason === "string" ? reason : null;
}

/**
 * Andamento do pedido para o cliente, a partir dos eventos de domínio dele.
 * Enquanto o pedido está pendente, a última linha é o que falta acontecer.
 */
export function OrderTimeline({ events, pending }: { events: OrderTimelineEvent[]; pending: boolean }) {
  const rows = [
    ...events.map((event) => ({
      key: event.id,
      label: EVENT_LABELS[event.type] ?? event.type,
      detail: event.type === "cancelled" ? describeCancellation(reasonOf(event.data)) : null,
      when: event.occurredAt,
      done: true,
      alert: event.type === "cancelled" || event.type === "refunded",
    })),
    ...(pending
      ? [{ key: "next", label: "Pagamento em verificação", detail: null, when: null, done: false, alert: false }]
      : []),
  ];

  return (
    <ol className="flex flex-col gap-2">
      {rows.map((row, index) => (
        <li key={row.key} className="flex items-start gap-3 text-sm">
          <span
            className={`serial mt-0.5 flex h-6 w-8 shrink-0 items-center justify-center border ${
              row.alert
                ? "border-signal bg-signal text-on-signal"
                : row.done
                  ? "border-foreground text-foreground"
                  : "border-border bg-background-elevated-hover text-foreground"
            }`}
          >
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{row.label}</span>
              <span className="label text-foreground-muted">
                {row.when ? row.when.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Em andamento"}
              </span>
            </span>
            {row.detail ? <span className="mt-0.5 block text-foreground-muted">{row.detail}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
