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
 * tanto para o cliente (página do pedido) quanto para o admin.
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
          {/* Índice do passo em mono; o estado vai em palavra ao lado. */}
          <span className={`serial mt-0.5 flex h-6 w-8 shrink-0 items-center justify-center border ${sagaStepStatusClass(step.status)}`}>
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{sagaStepLabel(step.name)}</span>
              <span className="label text-foreground-muted">
                {SAGA_STEP_STATUS_LABELS[step.status] ?? step.status}
                {/* `attempts` soma ida e compensação (as duas são contadas antes de
                    rodar); num passo desfeito "2 tentativas" leria como retry. */}
                {step.attempts > 1 && step.status !== "compensated" ? ` · ${step.attempts} tentativas` : ""}
              </span>
            </span>
            {showErrors && step.error ? (
              <span className="mt-0.5 block break-words font-mono text-[11px] text-foreground">{step.error}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
