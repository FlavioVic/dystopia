import type { QueueMetrics } from "@/queue/metrics";
import type { SagaMetrics } from "@/saga/metrics";

/**
 * Regras de alerta da operação, como função pura (testável sem banco).
 *
 * Alertam sobre o SISTEMA, não sobre o negócio: pagamento recusado vira saga
 * compensada, e isso é a saga funcionando — com o modo demonstração ligado
 * seria ruído o dia inteiro. O que alerta é o que exige alguém agir.
 */

export type AlertLevel = "critical" | "warning";

export type Alert = {
  id: "dead-letter" | "compensation-failed" | "queue-lag" | "stuck-sagas";
  level: AlertLevel;
  title: string;
  detail: string;
};

export type AlertThresholds = {
  /** Job pronto esperando mais que isso = ninguém consumindo a fila. */
  queueLagMs: number;
};

export const DEFAULT_THRESHOLDS: AlertThresholds = { queueLagMs: 60_000 };

export const HEALTH_WINDOWS = {
  "24h": { label: "24 h", ms: 24 * 60 * 60_000 },
  "7d": { label: "7 dias", ms: 7 * 24 * 60 * 60_000 },
} as const;
export type HealthWindow = keyof typeof HEALTH_WINDOWS;

/** Janela vinda da URL (`?janela=`); qualquer outra coisa cai no padrão. */
export function parseHealthWindow(raw: unknown): HealthWindow {
  return raw === "7d" ? "7d" : "24h";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1_000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1).replace(".", ",")} s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min`;
  return `${Math.floor(ms / 3_600_000)} h`;
}

export function computeAlerts(
  queue: Pick<QueueMetrics, "dead" | "ready" | "oldestReadyAgeMs">,
  sagas: Pick<SagaMetrics, "stuck"> & { failed: number },
  thresholds: AlertThresholds = DEFAULT_THRESHOLDS,
): Alert[] {
  const alerts: Alert[] = [];

  if (sagas.failed > 0) {
    alerts.push({
      id: "compensation-failed",
      level: "critical",
      title: `${plural(sagas.failed, "saga", "sagas")} com compensação falha`,
      detail: "Algo foi aplicado e não pôde ser desfeito — precisa de intervenção manual.",
    });
  }

  if (queue.dead > 0) {
    alerts.push({
      id: "dead-letter",
      level: "critical",
      title: `${plural(queue.dead, "job", "jobs")} na dead-letter`,
      detail: "Esgotaram as tentativas. Veja o erro e reprocesse depois de corrigir a causa.",
    });
  }

  if (queue.ready > 0 && queue.oldestReadyAgeMs > thresholds.queueLagMs) {
    alerts.push({
      id: "queue-lag",
      level: "warning",
      title: `Fila atrasada: job pronto esperando há ${formatDuration(queue.oldestReadyAgeMs)}`,
      detail: "Ninguém está consumindo a fila — o worker está rodando?",
    });
  }

  if (sagas.stuck > 0) {
    alerts.push({
      id: "stuck-sagas",
      level: "warning",
      title: `${plural(sagas.stuck, "saga parada", "sagas paradas")} no meio do caminho`,
      detail: "Sem progresso há mais de 5 min. A reconciliação reenfileira; se persistir, investigue.",
    });
  }

  return alerts;
}
