"use client";

import { useState } from "react";

/** Códigos de recuperação recém-gerados: aparecem uma vez, então dá para copiar. */
export function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border border-foreground p-5">
      <p className="text-sm leading-relaxed text-foreground">
        Guarde estes códigos fora do celular (gerenciador de senhas, papel). Cada um entra uma vez no lugar do código do
        autenticador. Eles não aparecem de novo.
      </p>
      <ol aria-label="Códigos de recuperação" className="grid grid-cols-1 gap-x-6 gap-y-1.5 font-mono text-sm sm:grid-cols-2">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <button
        type="button"
        onClick={copy}
        className="label self-start border border-border px-4 py-2 text-foreground hover:border-border-hover"
      >
        {copied ? "Copiados" : "Copiar códigos"}
      </button>
    </div>
  );
}
