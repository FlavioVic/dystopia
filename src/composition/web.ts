/**
 * Raiz de composição da borda web: os casos de uso de `src/application` com
 * o que só existe dentro do Next — hoje, o `after()` do worker embutido.
 *
 * É aqui, e só aqui, que a borda encontra a fila. A Server Action do checkout
 * chama `placeOrder` e recebe o número do pedido; não sabe se o resto anda num
 * worker em container ou num dreno depois da resposta.
 *
 * Worker embutido (`INLINE_WORKER=1`): no deploy só-Vercel não há processo de
 * fila de pé, então quem deixa trabalho na fila drena ela depois de responder.
 * Sem a flag — dev, ou deploy com o worker em container — não faz nada.
 * Vários drenos ao mesmo tempo são seguros: o broker entrega cada mensagem a
 * um consumidor só, o relay usa SKIP LOCKED e a saga tem lease.
 */

import { after } from "next/server";
import * as checkout from "@/application/checkout";
import * as orders from "@/application/orders";
import * as serviceRequests from "@/application/service-requests";
import { runInlineWorker, type InlineRunOptions } from "./worker";

/** Pagamento, resposta e e-mail — esperando retry em backoff se precisar. */
const CHECKOUT_DRAIN: InlineRunOptions = { budgetMs: 45_000, waitForScheduled: true };
/**
 * Rede de segurança: se o dreno do checkout morreu, cada visita empurra mais
 * um pouco — e reconcilia, para cobrar o pagamento que passou do prazo.
 */
const ORDER_VIEW_DRAIN: InlineRunOptions = { budgetMs: 10_000, reconcile: true };
/** Só o e-mail de alerta ao responsável. */
const SERVICE_REQUEST_DRAIN: InlineRunOptions = { budgetMs: 15_000 };
/** Painel de orquestração: reconcilia (lease de executor morto, retry perdido) e drena. */
const ADMIN_PANEL_DRAIN: InlineRunOptions = { budgetMs: 20_000, reconcile: true };

function inlineWorkerEnabled(): boolean {
  return process.env.INLINE_WORKER === "1";
}

function drainAfterResponse(options: InlineRunOptions): void {
  if (!inlineWorkerEnabled()) return;
  after(() => runInlineWorker(options));
}

export function placeOrder(input: checkout.PlaceOrderInput): Promise<checkout.PlaceOrderResult> {
  return checkout.placeOrder(input, { afterCommit: () => drainAfterResponse(CHECKOUT_DRAIN) });
}

export function viewOrder(orderNumber: string, userId: string): ReturnType<typeof orders.viewOrder> {
  return orders.viewOrder(orderNumber, userId, { whilePending: () => drainAfterResponse(ORDER_VIEW_DRAIN) });
}

export function submitServiceRequest(
  input: serviceRequests.SubmitServiceRequestInput,
): Promise<serviceRequests.SubmitServiceRequestResult> {
  return serviceRequests.submitServiceRequest(input, { afterCommit: () => drainAfterResponse(SERVICE_REQUEST_DRAIN) });
}

/** Abrir o painel faz o que o worker de pé faria (só com o worker embutido). */
export function runOperationsAfterResponse(): void {
  drainAfterResponse(ADMIN_PANEL_DRAIN);
}
