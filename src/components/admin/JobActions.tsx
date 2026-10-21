"use client";

import { useState, useTransition } from "react";
import { retryJob, runReconcile } from "@/lib/actions/admin";

/**
 * Sem `jobId` → botão de reconciliação manual.
 * Com `jobId` → reprocessa um job da dead-letter.
 */
export function JobActions({ jobId }: { jobId?: string }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = () =>
    startTransition(async () => {
      const result = jobId ? await retryJob(jobId) : await runReconcile();
      if (!result.ok) {
        setMsg({ ok: false, text: result.error ?? "Erro." });
        return;
      }
      setMsg({
        ok: true,
        text: jobId
          ? "Job devolvido pra fila."
          : `Reconciliado: ${Object.entries("report" in result && result.report ? result.report : {})
              .map(([key, value]) => `${key}=${value}`)
              .join(" ")}`,
      });
    });

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className={
          jobId
            ? "rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:border-border-hover disabled:opacity-50"
            : "rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-accent-foreground disabled:opacity-50"
        }
      >
        {pending ? "…" : jobId ? "Reprocessar" : "Rodar reconciliação"}
      </button>
      {msg ? (
        <span className={`text-[11px] ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</span>
      ) : null}
    </span>
  );
}
