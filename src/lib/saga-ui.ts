/**
 * Rótulos e cores da orquestração (usado pela página do pedido e pelo painel
 * admin). Sem import de servidor: componentes client também usam isso.
 */

export const SAGA_STEP_LABELS: Record<string, string> = {
  "reserve-stock": "Reserva de estoque",
  "authorize-payment": "Pagamento",
  "consume-coupon": "Cupom",
  "confirm-order": "Confirmação do pedido",
  "clear-cart": "Carrinho",
  "notify-customer": "Notificação",
};

export function sagaStepLabel(name: string): string {
  return SAGA_STEP_LABELS[name] ?? name;
}

export const SAGA_STATUS_LABELS: Record<string, string> = {
  running: "Em andamento",
  completed: "Concluída",
  compensating: "Desfazendo",
  compensated: "Desfeita",
  failed: "Falhou",
};

export const SAGA_STEP_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  waiting: "Aguardando resposta",
  completed: "OK",
  compensated: "Desfeito",
  failed: "Falhou",
};

export function sagaStatusClass(status: string): string {
  switch (status) {
    case "completed":
      return "bg-deal-soft text-success";
    case "running":
    case "compensating":
      return "bg-accent/10 text-accent";
    case "compensated":
      return "bg-accent-secondary/10 text-accent-secondary";
    case "failed":
      return "bg-danger/10 text-danger";
    default:
      return "bg-background-elevated-hover text-foreground-muted";
  }
}

export function sagaStepStatusClass(status: string): string {
  switch (status) {
    case "completed":
      return "border-success/40 bg-deal-soft text-success";
    case "compensated":
      return "border-accent-secondary/40 bg-accent-secondary/10 text-accent-secondary";
    case "failed":
      return "border-danger/40 bg-danger/10 text-danger";
    case "waiting":
      return "border-accent/40 bg-accent/10 text-accent";
    default:
      return "border-border bg-background-elevated-hover text-foreground-muted";
  }
}

export const JOB_STATUS_LABELS: Record<string, string> = {
  queued: "Na fila",
  running: "Executando",
  done: "Concluído",
  failed: "Vai tentar de novo",
  dead: "Dead-letter",
};

export function jobStatusClass(status: string): string {
  switch (status) {
    case "done":
      return "bg-deal-soft text-success";
    case "running":
    case "queued":
      return "bg-accent/10 text-accent";
    case "failed":
      return "bg-accent-secondary/10 text-accent-secondary";
    case "dead":
      return "bg-danger/10 text-danger";
    default:
      return "bg-background-elevated-hover text-foreground-muted";
  }
}
