import type { Metadata } from "next";
import Link from "next/link";
import { SagaTimeline } from "@/components/SagaTimeline";
import { JobActions } from "@/components/admin/JobActions";
import { requireAdmin } from "@/lib/data/auth";
import {
  getActiveAndDeadJobs,
  getJobStats,
  getRecentNotifications,
  getSagaStats,
  getSagasOverview,
} from "@/lib/data/orchestration";
import {
  jobStatusClass,
  JOB_STATUS_LABELS,
  sagaStatusClass,
  SAGA_STATUS_LABELS,
} from "@/lib/saga-ui";

export const metadata: Metadata = { title: "Orquestração · Admin" };

/**
 * Painel de orquestração: o estado da SAGA e da fila em tempo real.
 *
 * É a tela de operação do fluxo de checkout — onde se vê um pedido que
 * compensou, um job que vai tentar de novo, e o que caiu na dead-letter.
 */
export default async function OrchestrationPage() {
  await requireAdmin();

  const [sagasList, sagaStats, jobsList, jobStats, notifications] = await Promise.all([
    getSagasOverview(12),
    getSagaStats(),
    getActiveAndDeadJobs(20),
    getJobStats(),
    getRecentNotifications(8),
  ]);

  const cards = [
    { label: "Sagas", value: String(sagaStats.total) },
    { label: "Concluídas", value: String(sagaStats.byStatus.completed ?? 0) },
    { label: "Compensadas", value: String(sagaStats.byStatus.compensated ?? 0) },
    {
      label: "Precisam de ação",
      value: String((sagaStats.byStatus.failed ?? 0) + (jobStats.dead ?? 0)),
      warn: (sagaStats.byStatus.failed ?? 0) + (jobStats.dead ?? 0) > 0,
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-border bg-background-elevated p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-foreground-muted">{card.label}</p>
            <p
              className={`mt-1.5 font-mono text-2xl font-bold tabular-nums ${card.warn ? "text-danger" : ""}`}
            >
              {card.value}
            </p>
          </div>
        ))}
      </div>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">
            Fila ({Object.entries(jobStats).map(([status, count]) => `${JOB_STATUS_LABELS[status] ?? status}: ${count}`).join(" · ") || "vazia"})
          </h2>
          <JobActions />
        </div>

        {jobsList.length === 0 ? (
          <p className="mt-4 text-sm text-foreground-muted">Nenhum job pendente — tudo processado.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-border bg-background-elevated text-left text-xs text-foreground-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Tipo</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Tentativas</th>
                  <th className="px-4 py-2.5 font-medium">Próxima execução</th>
                  <th className="px-4 py-2.5 font-medium">Último erro</th>
                  <th className="px-4 py-2.5 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {jobsList.map((job) => (
                  <tr key={job.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-mono text-xs">{job.type}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${jobStatusClass(job.status)}`}>
                        {JOB_STATUS_LABELS[job.status] ?? job.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {job.attempts}/{job.maxAttempts}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-foreground-muted">
                      {new Date(job.runAt).toLocaleString("pt-BR")}
                    </td>
                    <td className="max-w-[18rem] px-4 py-2.5 text-xs text-foreground-muted">
                      <span className="line-clamp-2">{job.lastError ?? "—"}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {job.status === "dead" ? <JobActions jobId={job.id} /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Sagas recentes</h2>

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
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${sagaStatusClass(saga.status)}`}>
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
                  {saga.lockedBy ? <span>· executando em {saga.lockedBy}</span> : null}
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">
          Notificações enviadas
        </h2>
        {notifications.length === 0 ? (
          <p className="mt-4 text-sm text-foreground-muted">Nada enviado ainda.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
            {notifications.map((notification) => (
              <li key={notification.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="line-clamp-1 font-medium">{notification.subject}</span>
                  <span className="text-xs text-foreground-muted">{notification.recipient}</span>
                </span>
                <span className="text-xs text-foreground-muted">
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
