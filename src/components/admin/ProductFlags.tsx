"use client";

import { useState, useTransition } from "react";
import { toggleProductFlag } from "@/lib/actions/admin";

export function ProductFlags({
  id,
  isActive,
  isFeatured,
}: {
  id: string;
  isActive: boolean;
  isFeatured: boolean;
}) {
  const [active, setActive] = useState(isActive);
  const [featured, setFeatured] = useState(isFeatured);
  const [pending, startTransition] = useTransition();

  function toggle(field: "isActive" | "isFeatured", cur: boolean, setter: (v: boolean) => void) {
    startTransition(async () => {
      const r = await toggleProductFlag(id, field);
      if (r.ok) setter(!cur);
    });
  }

  const chip = (on: boolean) =>
    `label border px-2.5 py-1 disabled:opacity-50 ${
      on
        ? "border border-foreground text-foreground"
        : "bg-background-elevated-hover text-foreground-muted hover:text-foreground"
    }`;

  return (
    <div className="flex gap-1.5">
      <button type="button" disabled={pending} onClick={() => toggle("isActive", active, setActive)} className={chip(active)}>
        {active ? "Ativo" : "Inativo"}
      </button>
      <button type="button" disabled={pending} onClick={() => toggle("isFeatured", featured, setFeatured)} className={chip(featured)}>
        {featured ? "★ Destaque" : "Destaque"}
      </button>
    </div>
  );
}
