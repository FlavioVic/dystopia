"use client";

import { useState, useTransition } from "react";
import { updateOrderStatus } from "@/lib/actions/admin";
import { isOrderStatus, nextStatuses, ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/order-status";

/**
 * Troca de status do pedido. O select só oferece transições válidas (a
 * máquina de estados está em `@/lib/order-status` e é revalidada no servidor).
 */
export function OrderStatusForm({ orderId, current }: { orderId: string; current: string }) {
  const [status, setStatus] = useState(current);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const currentStatus: OrderStatus | null = isOrderStatus(current) ? current : null;
  const options = currentStatus ? [currentStatus, ...nextStatuses(currentStatus)] : [];
  const dirty = status !== current;

  if (!currentStatus) {
    return <p className="text-sm text-foreground-muted">Status desconhecido: {current}</p>;
  }

  if (options.length === 1) {
    return (
      <p className="text-sm text-foreground-muted">
        <span className="font-medium text-foreground">{ORDER_STATUS_LABELS[currentStatus]}</span> é um status
        final — não há próxima transição.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={status}
        onChange={(e) => {
          setStatus(e.target.value);
          setMsg(null);
        }}
        className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {ORDER_STATUS_LABELS[option]}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!dirty || pending}
        onClick={() =>
          startTransition(async () => {
            const result = await updateOrderStatus(orderId, status);
            setMsg(
              result.ok
                ? { ok: true, text: "Status atualizado." }
                : { ok: false, text: result.error ?? "Erro." },
            );
          })
        }
        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Salvando…" : "Salvar"}
      </button>
      {msg ? (
        <span className={`text-xs ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</span>
      ) : null}
    </div>
  );
}
