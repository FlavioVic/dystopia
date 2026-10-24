import type { Metadata } from "next";
import Link from "next/link";
import { SagaTimeline } from "@/components/SagaTimeline";
import { QueueActions } from "@/components/admin/QueueActions";
import { requireAdmin } from "@/lib/data/auth";
import { drainQueueAfterResponse } from "@/lib/inline-worker";
import {
  getDeadLetters,
  getOperationalHealth,
  getRecentNotifications,
  getSagasOverview,
} from "@/lib/data/orchestration";
import { formatDuration, HEALTH_WINDOWS, parseHealthWindow, type HealthWindow } from "@/lib/observability";
import {
  sagaStatusClass,
  sagaStepLabel,
  SAGA_STATUS_LABELS,
} from "@/lib/saga-ui";

export const metadata: Metadata = { title: "Orquestração · Admin" };
export const maxDuration = 30;

const NOTIFICATION_STATUS = {
  pending: { label: "Na fila", className: "bg-background-elevated text-accent" },
  sent: { label: "Enviada", className: "border border-foreground text-foreground" },
  failed: { label: "Falhou", className: "bg-signal text-on-signal" },
} as const;

/**
 * Painel de orquestração: o estado da SAGA e da fila em tempo real.
 *
 * É a tela de operação do fluxo de checkout — onde se vê um pedido que
 * compensou, mensagem esperando retry no RabbitMQ, e o que caiu na DLQ.
 */
export default async function OrchestrationPage(props: PageProps<"/admin/orquestracao">) {
  await requireAdmin();
  // Worker embutido: abrir o painel reconcilia e drena (retry que voltou da
  // fila de espera, lease de executor morto) — o que o worker de pé faria.
  drainQueueAfterResponse({ budgetMs: 20_000, reconcile: true });
  const range = parseHealthWindow((await props.searchParams).janela);

  const [sagasList, health, notifications] = await Promise.all([
    getSagasOverview(12),
    getOperationalHealth(range),
    getRecentNotifications(8),
  ]);
  const { sagas: sagaMetrics, queue: queueMetrics } = health;
  const deadLetters = await getDeadLetters(
    queueMetrics.queues.filter((depth) => depth.dead > 0).map((depth) => depth.queue),
    20,
  );
  const brokerDown = queueMetrics.broker.status === "down";

  const finished =
    (sagaMetrics.byStatus.completed ?? 0) + (sagaMetrics.byStatus.compensated ?? 0) + (sagaMetrics.byStatus.failed ?? 0);
  const needsAction = (sagaMetrics.byStatus.failed ?? 0) + queueMetrics.dead;

  const cards = [
    {
      label: "Taxa de conclusão",
      value: sagaMetrics.completionRate == null ? "—" : `${Math.round(sagaMetrics.completionRate * 100)}%`,
      hint: `${sagaMetrics.byStatus.completed ?? 0} de ${finished} terminadas · o resto foi desfeito`,
    },
    {
      label: "Tempo até confirmar",
      value: formatDuration(sagaMetrics.p50Ms),
      hint: `p50 · p95 ${formatDuration(sagaMetrics.p95Ms)}`,
    },
    {
      label: "Fila",
      value: brokerDown ? "—" : String(queueMetrics.ready + queueMetrics.retrying),
      hint: brokerDown
        ? "RabbitMQ inacessível"
        : `${queueMetrics.ready} prontas · ${queueMetrics.retrying} em espera de retry`,
    },
    {
      label: "Precisam de ação",
      value: String(needsAction),
      hint: "DLQ + compensações que falharam",
      warn: needsAction > 0,
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="label text-foreground-muted">
            Saúde · últimas {HEALTH_WINDOWS[range].label}
          </h2>
          <nav className="flex gap-1 text-xs" aria-label="Janela das métricas">
            {(Object.keys(HEALTH_WINDOWS) as HealthWindow[]).map((key) => (
              <Link
                key={key}
                href={key === "24h" ? "/admin/orquestracao" : `/admin/orquestracao?janela=${key}`}
                className={`rounded-md px-2.5 py-1 font-medium ${key === range ? "bg-background-elevated text-accent" : "text-foreground-muted hover:text-foreground"}`}
              >
                {HEALTH_WINDOWS[key].label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {cards.map((card) => (
            <div key={card.label} className="rounded-xl border border-border bg-background-elevated p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-foreground-muted">{card.label}</p>
              <p className={`mt-1.5 font-mono text-2xl font-bold tabular-nums ${card.warn ? "text-foreground" : ""}`}>
                {card.value}
              </p>
              <p className="mt-1 text-[11px] text-foreground-muted">{card.hint}</p>
            </div>
          ))}
        </div>

        {sagaMetrics.steps.length > 0 ? (
          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-border bg-background-elevated text-left text-xs text-foreground-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Passo</th>
                  <th className="px-4 py-2.5 text-right font-medium">Execuções</th>
                  <th className="px-4 py-2.5 text-right font-medium">Com retry</th>
                  <th className="px-4 py-2.5 text-right font-medium">Falhas</th>
                  <th className="px-4 py-2.5 text-right font-medium" title="Inclui a espera de backoff entre tentativas">
                    p50 · p95
                  </th>
                </tr>
              </thead>
              <tbody>
                {sagaMetrics.steps.map((step) => (
                  <tr key={step.name} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5">{sagaStepLabel(step.name)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{step.executions}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${step.retried > 0 ? "text-foreground-muted" : ""}`}>
                      {step.retried}
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${step.failed > 0 ? "text-foreground" : ""}`}>
                      {step.failed}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-foreground-muted">
                      {formatDuration(step.p50Ms)} · {formatDuration(step.p95Ms)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-sm text-foreground-muted">Nenhuma saga nessa janela.</p>
        )}
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="label text-foreground-muted">Fila · RabbitMQ</h2>
          <QueueActions />
        </div>

        {brokerDown ? (
          <p className="mt-4 border border-border bg-background-elevated px-4 py-3 text-sm">
            Broker inacessível: {queueMetrics.broker.status === "down" ? queueMetrics.broker.error : ""}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-border bg-background-elevated text-left text-xs text-foreground-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Fila</th>
                  <th className="px-4 py-2.5 text-right font-medium">Prontas</th>
                  <th className="px-4 py-2.5 text-right font-medium" title="Nas filas de espera (TTL) até o próximo retry">
                    Em espera
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">DLQ</th>
                  <th className="px-4 py-2.5 text-right font-medium">Consumidores</th>
                </tr>
              </thead>
              <tbody>
                {queueMetrics.queues.map((depth) => (
                  <tr key={depth.queue} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-mono text-xs">{depth.queue}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{depth.ready}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{depth.retrying}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${depth.dead > 0 ? "font-semibold" : ""}`}>
                      {depth.dead}
                      {depth.dead > 0 ? (
                        <span className="ml-2">
                          <QueueActions queue={depth.queue} />
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-foreground-muted">{depth.consumers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-xs text-foreground-muted">
          Outbox: {queueMetrics.outbox.pending === 0
            ? "tudo publicado"
            : `${queueMetrics.outbox.pending} esperando publicação (mais antiga há ${formatDuration(queueMetrics.outbox.oldestPendingAgeMs)}${queueMetrics.outbox.failing > 0 ? `, ${queueMetrics.outbox.failing} com falha de publicação` : ""})`}
          .
        </p>

        {deadLetters.length > 0 ? (
          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-border bg-background-elevated text-left text-xs text-foreground-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">DLQ · tipo</th>
                  <th className="px-4 py-2.5 font-medium">Fila</th>
                  <th className="px-4 py-2.5 font-medium">Tentativas</th>
                  <th className="px-4 py-2.5 font-medium">Caiu em</th>
                  <th className="px-4 py-2.5 font-medium">Erro</th>
                  <th className="px-4 py-2.5 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {deadLetters.map((letter) => (
                  <tr key={`${letter.queue}:${letter.id}`} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-mono text-xs">{letter.type}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{letter.queue}</td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {letter.attempts}/{letter.maxAttempts}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-foreground-muted">
                      {letter.failedAt ? new Date(letter.failedAt).toLocaleString("pt-BR") : "—"}
                    </td>
                    <td className="max-w-[18rem] px-4 py-2.5 text-xs text-foreground-muted">
                      <span className="line-clamp-2">{letter.error ?? "—"}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <QueueActions queue={letter.queue} messageId={letter.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="label text-foreground-muted">Sagas recentes</h2>

        {sagasList.length === 0 ? (
          <p className="mt-4 text-sm text-foreground-muted">Nenhuma saga ainda — faça um pedido pra ver.</p>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {sagasList.map((saga) => (
              <article key={saga.id} className="rounded-xl border border-border p-4">
                <header className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold">{saga.type}</span>
                    <Link
                      href={`/admin/pedidos/${saga.correlationId}`}
                      className="font-mono text-xs font-semibold text-accent hover:underline"
                    >
                      {saga.correlationId}
                    </Link>
                  </div>
                  <span className={`label whitespace-nowrap px-2 py-0.5 ${sagaStatusClass(saga.status)}`}>
                    {SAGA_STATUS_LABELS[saga.status] ?? saga.status}
                  </span>
                </header>

                <div className="mt-3">
                  <SagaTimeline
                    showErrors
                    steps={saga.steps.map((step) => ({
                      id: step.id,
                      name: step.name,
                      status: step.status,
                      attempts: step.attempts,
                      error: step.error,
                    }))}
                  />
                </div>

                {saga.lastError ? (
                  <p className="mt-3 break-words rounded-lg border border-border bg-background-elevated px-3 py-2 font-mono text-[11px] text-foreground-muted">
                    {saga.lastError}
                  </p>
                ) : null}

                <footer className="mt-3 flex flex-wrap gap-3 text-[11px] text-foreground-muted">
                  <span>criada {new Date(saga.createdAt).toLocaleString("pt-BR")}</span>
                  {saga.finishedAt ? <span>· fim {new Date(saga.finishedAt).toLocaleString("pt-BR")}</span> : null}
                  {saga.lockedBy === "backoff" && saga.leaseUntil ? (
                    <span>· retry às {new Date(saga.leaseUntil).toLocaleTimeString("pt-BR")}</span>
                  ) : saga.lockedBy ? (
                    <span>· executando em {saga.lockedBy}</span>
                  ) : null}
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="label text-foreground-muted">
          Notificações
        </h2>
        {notifications.length === 0 ? (
          <p className="mt-4 text-sm text-foreground-muted">Nada enviado ainda.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
            {notifications.map((notification) => (
              <li key={notification.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="line-clamp-1 font-medium">{notification.subject}</span>
                  <span className="block text-xs text-foreground-muted">
                    {notification.recipient}
                    {/* Sandbox: o e-mail foi pra outro endereço — mostra pra onde. */}
                    {notification.deliveredTo && notification.deliveredTo !== notification.recipient
                      ? ` → entregue em ${notification.deliveredTo}`
                      : ""}
                    {notification.provider ? ` · ${notification.provider}` : ""}
                  </span>
                  {notification.status === "failed" && notification.lastError ? (
                    <span className="block text-xs text-foreground">{notification.lastError}</span>
                  ) : null}
                </span>
                <span className="flex items-center gap-2 text-xs text-foreground-muted">
                  <span className={`label whitespace-nowrap px-2 py-0.5 ${NOTIFICATION_STATUS[notification.status].className}`}>
                    {NOTIFICATION_STATUS[notification.status].label}
                  </span>
                  {new Date(notification.createdAt).toLocaleString("pt-BR")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
