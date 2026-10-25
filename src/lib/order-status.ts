export const ORDER_STATUSES = [
  "pending",
  "paid",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Status que contam como receita: dinheiro aprovado e não devolvido. Pendente
 * ainda pode falhar; cancelado e reembolsado não ficaram com a loja.
 */
export const REVENUE_STATUSES = ["paid", "processing", "shipped", "delivered"] as const satisfies readonly OrderStatus[];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pendente",
  paid: "Pago",
  processing: "Processando",
  shipped: "Enviado",
  delivered: "Entregue",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
};

/** Classe de cor (Tailwind) para o badge de status. */
export function orderStatusClass(status: string): string {
  switch (status) {
    case "delivered":
    case "paid":
      return "border border-foreground text-foreground";
    case "shipped":
    case "processing":
      return "bg-foreground text-background";
    case "cancelled":
    case "refunded":
      return "bg-signal text-on-signal";
    default:
      return "border border-border-faint text-foreground-muted";
  }
}

/**
 * Máquina de estados do pedido. Status não é campo livre: o painel admin e a
 * saga passam por aqui, então "entregue → pendente" simplesmente não existe.
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["paid", "cancelled"],
  paid: ["processing", "shipped", "cancelled", "refunded"],
  processing: ["shipped", "cancelled", "refunded"],
  shipped: ["delivered", "refunded"],
  delivered: ["refunded"],
  cancelled: [],
  refunded: [],
};

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Próximos status possíveis — usado para o select do admin não oferecer bobagem. */
export function nextStatuses(from: OrderStatus): OrderStatus[] {
  return [...ALLOWED_TRANSITIONS[from]];
}

/** Status terminal: não sai mais de lá. */
export function isTerminalStatus(status: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}
