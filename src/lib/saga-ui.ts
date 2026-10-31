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
  halted: "Parada",
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
      return "border border-foreground text-foreground";
    case "running":
    case "compensating":
      return "bg-foreground text-background";
    case "compensated":
      return "border border-border text-foreground-muted";
    case "failed":
    case "halted":
      return "bg-signal text-on-signal";
    default:
      return "border border-border-faint text-foreground-muted";
  }
}

export function sagaStepStatusClass(status: string): string {
  switch (status) {
    case "completed":
      return "border-foreground text-foreground";
    case "compensated":
      return "border-border text-foreground-muted";
    case "failed":
      return "border-signal bg-signal text-on-signal";
    case "waiting":
      return "border-foreground bg-foreground text-background";
    default:
      // Em andamento. Texto cheio: o muted sobre o elevated-hover não passa
      // contraste AA (o axe pegou quando a varredura caiu numa saga no meio).
      return "border-border bg-background-elevated-hover text-foreground";
  }
}
