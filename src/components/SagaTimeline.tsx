import { sagaStepLabel, sagaStepStatusClass, SAGA_STEP_STATUS_LABELS } from "@/lib/saga-ui";

export type SagaTimelineStep = {
  id: string;
  name: string;
  status: string;
  attempts: number;
  error: string | null;
};

/**
 * Linha do tempo dos passos da saga. É o que torna a orquestração visível —
 * tanto pro cliente (página do pedido) quanto pro admin.
 */
export function SagaTimeline({
  steps,
  showErrors = false,
}: {
  steps: SagaTimelineStep[];
  showErrors?: boolean;
}) {
  if (steps.length === 0) {
    return <p className="text-sm text-foreground-muted">A orquestração ainda não começou.</p>;
  }

  return (
    <ol className="flex flex-col gap-2">
      {steps.map((step, index) => (
        <li key={step.id} className="flex items-start gap-3 text-sm">
          <span
            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-bold ${sagaStepStatusClass(step.status)}`}
          >
            {step.status === "completed" ? "✓" : step.status === "failed" ? "!" : index + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{sagaStepLabel(step.name)}</span>
              <span className="text-[11px] uppercase tracking-wide text-foreground-muted">
                {SAGA_STEP_STATUS_LABELS[step.status] ?? step.status}
                {/* `attempts` soma ida e compensação (as duas são contadas antes de
                    rodar); num passo desfeito "2 tentativas" leria como retry. */}
                {step.attempts > 1 && step.status !== "compensated" ? ` · ${step.attempts} tentativas` : ""}
              </span>
            </span>
            {showErrors && step.error ? (
              <span className="mt-0.5 block break-words font-mono text-[11px] text-danger">{step.error}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
