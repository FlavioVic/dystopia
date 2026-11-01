"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

/**
 * Campo de cartão do Stripe (Elements). O número digitado fica num iframe do
 * próprio Stripe: o nosso código nunca vê o cartão, só recebe um token
 * (`pm_…`) para mandar no formulário — é o que tira o site do escopo de PCI.
 *
 * O Stripe.js é carregado de js.stripe.com por exigência do Stripe (não pode
 * ser empacotado), então não entra como dependência npm.
 */

type CardChangeEvent = { complete: boolean; error?: { message: string } };
type CardElement = {
  mount: (element: HTMLElement) => void;
  destroy: () => void;
  on: (event: "change", handler: (event: CardChangeEvent) => void) => void;
};
type StripeJs = {
  elements: () => { create: (type: "card", options: Record<string, unknown>) => CardElement };
  createPaymentMethod: (options: { type: "card"; card: CardElement }) => Promise<{
    paymentMethod?: { id: string };
    error?: { message?: string };
  }>;
};

declare global {
  interface Window {
    Stripe?: (publishableKey: string, options?: { locale?: string }) => StripeJs;
  }
}

const STRIPE_JS = "https://js.stripe.com/v3/";
let loading: Promise<void> | null = null;

function loadStripeJs(): Promise<void> {
  if (window.Stripe) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = STRIPE_JS;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error("Stripe.js não carregou"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export type StripeCardHandle = {
  /** Valida o cartão no Stripe e devolve o token, ou a mensagem de erro. */
  createPaymentMethod: () => Promise<{ id: string } | { error: string }>;
};

export function StripeCardField({ publishableKey, ref }: { publishableKey: string; ref: Ref<StripeCardHandle> }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<StripeJs | null>(null);
  const cardRef = useRef<CardElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let card: CardElement | null = null;

    loadStripeJs()
      .then(() => {
        if (cancelled || !window.Stripe || !mountRef.current) return;
        const stripe = window.Stripe(publishableKey, { locale: "pt-BR" });
        // O campo mora num iframe: não enxerga as CSS vars, então vão por valor.
        const css = getComputedStyle(document.documentElement);
        const token = (name: string) => css.getPropertyValue(name).trim();
        card = stripe.elements().create("card", {
          hidePostalCode: true,
          // Sem o botão do Link (a carteira do Stripe) dentro do campo: numa
          // loja em modo de teste ele não serve, e ao perder o foco ele puxa
          // o foco de volta e muda a altura do campo — no celular, o toque em
          // "Confirmar aquisição" escorregava para fora do botão.
          disableLink: true,
          style: {
            base: {
              fontSize: "14px",
              color: token("--foreground"),
              "::placeholder": { color: token("--foreground-muted") },
            },
            invalid: { color: token("--danger") },
          },
        });
        card.mount(mountRef.current);
        card.on("change", (event) => setError(event.error?.message ?? null));
        stripeRef.current = stripe;
        cardRef.current = card;
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });

    return () => {
      cancelled = true;
      card?.destroy();
      cardRef.current = null;
    };
  }, [publishableKey]);

  useImperativeHandle(
    ref,
    () => ({
      async createPaymentMethod() {
        if (!stripeRef.current || !cardRef.current) return { error: "O campo de cartão ainda não carregou." };
        const result = await stripeRef.current.createPaymentMethod({ type: "card", card: cardRef.current });
        if (result.error || !result.paymentMethod) {
          return { error: result.error?.message ?? "Não foi possível validar o cartão." };
        }
        return { id: result.paymentMethod.id };
      },
    }),
    [],
  );

  return (
    <div className="mt-4">
      <div
        ref={mountRef}
        className="min-h-10 rounded-lg border border-border bg-background px-3 py-2.5 transition-colors focus-within:border-foreground"
      />
      {status === "loading" ? (
        <p className="mt-1.5 text-xs text-foreground-muted">Carregando o campo seguro do Stripe…</p>
      ) : null}
      {status === "failed" ? (
        <p className="mt-1.5 text-xs text-foreground">Não foi possível carregar o Stripe. Recarregue a página.</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-foreground">
          {error}
        </p>
      ) : null}
      <p className="mt-2 text-[11px] leading-relaxed text-foreground-muted">
        Stripe em modo de teste — nenhum cartão real é cobrado. Use{" "}
        <span className="font-mono text-foreground">4242 4242 4242 4242</span> para aprovar ou{" "}
        <span className="font-mono text-foreground">4000 0000 0000 0002</span> para ver a recusa, com qualquer
        validade futura e qualquer CVC.
      </p>
    </div>
  );
}
