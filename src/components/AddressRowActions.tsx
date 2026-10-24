"use client";

import { useState, useTransition } from "react";
import { makeDefaultAddress, removeAddress } from "@/lib/actions/addresses";

export function AddressRowActions({ addressId, isDefault }: { addressId: string; isDefault: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const result = await action();
      setError(result.ok ? null : result.error ?? "Erro.");
    });

  return (
    <div className="flex flex-wrap items-center gap-3">
      {isDefault ? null : (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => makeDefaultAddress(addressId))}
          className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
        >
          Tornar padrão
        </button>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => removeAddress(addressId))}
        className="text-xs font-medium text-foreground-muted hover:text-foreground disabled:opacity-50"
      >
        Remover
      </button>
      {error ? <span className="text-[11px] text-foreground">{error}</span> : null}
    </div>
  );
}
