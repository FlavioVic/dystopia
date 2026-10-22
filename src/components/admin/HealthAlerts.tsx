import Link from "next/link";
import type { Alert } from "@/lib/observability";

/**
 * Faixa de alertas da operação, no topo de toda página do admin: problema na
 * fila ou na saga não pode depender de alguém abrir o painel certo.
 */
export function HealthAlerts({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return null;

  return (
    <ul className="mt-4 flex flex-col gap-2" aria-label="Alertas da operação">
      {alerts.map((alert) => (
        <li
          key={alert.id}
          className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border px-4 py-2.5 text-sm ${
            alert.level === "critical"
              ? "border-danger/30 bg-danger/5 text-danger"
              : "border-accent-secondary/30 bg-accent-secondary/5 text-accent-secondary"
          }`}
        >
          <span className="min-w-0">
            <span className="font-semibold">{alert.title}</span>
            <span className="text-foreground-muted"> — {alert.detail}</span>
          </span>
          <Link href="/admin/orquestracao" className="shrink-0 text-xs font-semibold hover:underline">
            ver orquestração →
          </Link>
        </li>
      ))}
    </ul>
  );
}
