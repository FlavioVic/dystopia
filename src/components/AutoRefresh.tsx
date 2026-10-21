"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Recarrega os dados do Server Component em intervalos — usado enquanto a
 * saga do pedido está em andamento (o worker pode terminar a qualquer
 * momento). Para sozinho depois de `maxTicks` pra não ficar girando pra
 * sempre numa aba esquecida aberta.
 */
export function AutoRefresh({ intervalMs = 3_000, maxTicks = 20 }: { intervalMs?: number; maxTicks?: number }) {
  const router = useRouter();

  useEffect(() => {
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      if (ticks > maxTicks) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, intervalMs);

    return () => clearInterval(timer);
  }, [intervalMs, maxTicks, router]);

  return null;
}
