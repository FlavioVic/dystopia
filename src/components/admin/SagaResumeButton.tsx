"use client";

import { useState, useTransition } from "react";
import { resumeSaga } from "@/lib/actions/admin";

/** Retoma uma saga parada depois do pagamento — usar depois de corrigir a causa. */
export function SagaResumeButton({ sagaId }: { sagaId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = () =>
    startTransition(async () => {
      const result = await resumeSaga(sagaId);
      setError(result.ok ? null : (result.error ?? "Erro."));
    });

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
      >
        {pending ? "…" : "Retomar"}
      </button>
      {error ? <span className="text-[11px] text-foreground">{error}</span> : null}
    </span>
  );
}
