"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { AdminFormState } from "@/lib/actions/admin";

type Defaults = {
  code?: string;
  description?: string | null;
  discountType?: "percentage" | "fixed";
  discountValue?: string;
  minOrder?: string;
  maxUsage?: string;
  validFrom?: string;
  validUntil?: string;
  isActive?: boolean;
  usageCount?: number;
};

const input =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-foreground-muted focus:border-accent";
const label = "text-[11px] font-medium uppercase tracking-wide text-foreground-muted";

export function CouponForm({
  action,
  defaults = {},
  mode,
}: {
  action: (prev: AdminFormState, formData: FormData) => Promise<AdminFormState>;
  defaults?: Defaults;
  mode: "create" | "edit";
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [discountType, setDiscountType] = useState<"percentage" | "fixed">(
    defaults.discountType ?? "percentage",
  );
  const errors = state?.errors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state?.message ? (
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="code" className={label}>
            Código
          </label>
          <input
            id="code"
            name="code"
            defaultValue={defaults.code}
            placeholder="BEMVINDO10"
            className={`${input} font-mono uppercase`}
          />
          {errors.code ? <span className="text-[11px] text-danger">{errors.code}</span> : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="discountType" className={label}>
            Tipo
          </label>
          <select
            id="discountType"
            name="discountType"
            value={discountType}
            onChange={(event) => setDiscountType(event.target.value as "percentage" | "fixed")}
            className={input}
          >
            <option value="percentage">Percentual (%)</option>
            <option value="fixed">Valor fixo (R$)</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="discountValue" className={label}>
            {discountType === "percentage" ? "Desconto (%)" : "Desconto (R$)"}
          </label>
          <input
            id="discountValue"
            name="discountValue"
            defaultValue={defaults.discountValue}
            placeholder={discountType === "percentage" ? "10" : "25,00"}
            className={input}
          />
          {errors.discountValue ? (
            <span className="text-[11px] text-danger">{errors.discountValue}</span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="minOrder" className={label}>
            Pedido mínimo (R$, opcional)
          </label>
          <input id="minOrder" name="minOrder" defaultValue={defaults.minOrder} placeholder="0" className={input} />
          {errors.minOrder ? <span className="text-[11px] text-danger">{errors.minOrder}</span> : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="maxUsage" className={label}>
            Limite de usos (vazio = ilimitado)
          </label>
          <input id="maxUsage" name="maxUsage" defaultValue={defaults.maxUsage} className={input} />
          {errors.maxUsage ? <span className="text-[11px] text-danger">{errors.maxUsage}</span> : null}
          {mode === "edit" && defaults.usageCount != null ? (
            <span className="text-[11px] text-foreground-muted">
              já usado {defaults.usageCount} vez(es)
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="validFrom" className={label}>
            Válido de
          </label>
          <input
            id="validFrom"
            name="validFrom"
            type="date"
            defaultValue={defaults.validFrom}
            className={input}
          />
          {errors.validFrom ? <span className="text-[11px] text-danger">{errors.validFrom}</span> : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="validUntil" className={label}>
            Válido até (opcional)
          </label>
          <input
            id="validUntil"
            name="validUntil"
            type="date"
            defaultValue={defaults.validUntil}
            className={input}
          />
          {errors.validUntil ? <span className="text-[11px] text-danger">{errors.validUntil}</span> : null}
        </div>

        <div className="flex flex-col gap-1 sm:col-span-2">
          <label htmlFor="description" className={label}>
            Descrição (aparece na loja)
          </label>
          <input
            id="description"
            name="description"
            defaultValue={defaults.description ?? ""}
            placeholder="10% OFF na primeira compra"
            className={input}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={defaults.isActive ?? true}
          className="accent-[var(--accent)]"
        />
        Ativo
      </label>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-50"
        >
          {pending ? "Salvando…" : mode === "create" ? "Criar cupom" : "Salvar alterações"}
        </button>
        <Link
          href="/admin/cupons"
          className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium hover:border-border-hover"
        >
          Cancelar
        </Link>
      </div>
    </form>
  );
}
