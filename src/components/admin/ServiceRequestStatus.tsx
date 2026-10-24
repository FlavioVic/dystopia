"use client";

import { useState, useTransition } from "react";
import { updateServiceRequestStatus } from "@/lib/actions/admin";

export const SERVICE_REQUEST_STATUS_LABELS: Record<string, string> = {
  novo: "Novo",
  em_contato: "Em contato",
  fechado: "Fechado",
  arquivado: "Arquivado",
};

/** Seletor de andamento do orçamento. Erro volta como palavra, não cor. */
export function ServiceRequestStatus({ id, status }: { id: string; status: string }) {
  const [value, setValue] = useState(status);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-1">
      <select
        value={value}
        disabled={pending}
        aria-label="Andamento do orçamento"
        onChange={(event) => {
          const next = event.target.value;
          const previous = value;
          setValue(next);
          setError(null);
          startTransition(async () => {
            const result = await updateServiceRequestStatus(id, next);
            if (!result.ok) {
              setValue(previous);
              setError(result.error ?? "Falhou.");
            }
          });
        }}
        className="border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground"
      >
        {Object.entries(SERVICE_REQUEST_STATUS_LABELS).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      {error ? <span className="text-xs text-foreground">{error}</span> : null}
    </div>
  );
}
