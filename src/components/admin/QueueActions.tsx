"use client";

import { useState, useTransition } from "react";
import { replayDeadLetter, runReconcile } from "@/lib/actions/admin";

/**
 * Sem `queue` → reconciliação manual.
 * Com `queue` → reprocessa a DLQ daquela fila (tudo, ou só `messageId`).
 */
export function QueueActions({ queue, messageId }: { queue?: string; messageId?: string }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = () =>
    startTransition(async () => {
      const result = queue ? await replayDeadLetter(queue, messageId) : await runReconcile();
      if (!result.ok) {
        setMsg({ ok: false, text: result.error ?? "Erro." });
        return;
      }
      setMsg({
        ok: true,
        text: queue
          ? "Devolvido para a fila."
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
          queue
            ? "rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:border-border-hover disabled:opacity-50"
            : "rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        }
      >
        {pending ? "…" : queue ? (messageId ? "Reprocessar" : "Reprocessar todas") : "Rodar reconciliação"}
      </button>
      {msg ? <span className="text-[11px] text-foreground">{msg.text}</span> : null}
    </span>
  );
}
