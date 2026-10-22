import type { Metadata } from "next";
import Link from "next/link";
import { isCheckoutSimulationEnabled } from "@/lib/checkout-simulation";
import { sagaStepLabel } from "@/lib/saga-ui";

export const metadata: Metadata = {
  title: "Sobre o projeto",
  description: "Dystopia é um projeto de portfólio: e-commerce em Next.js com checkout orquestrado por SAGA.",
};

const REPO_URL = "https://github.com/FlavioVic/dystopia";

// Espelha `steps` de src/saga/definitions/checkout.ts — aqui é texto de vitrine,
// então a compensação vem descrita em linguagem de cliente, não o nome da função.
const SAGA_STEPS = [
  { name: "reserve-stock", undo: "devolve as unidades" },
  { name: "authorize-payment", undo: "estorna a cobrança" },
  { name: "consume-coupon", undo: "devolve o uso do cupom" },
  { name: "confirm-order", undo: "cancela o pedido" },
  { name: "clear-cart", undo: "restaura o carrinho" },
  { name: "notify-customer", undo: null },
];

const HIGHLIGHTS = [
  {
    title: "Checkout como SAGA",
    body: "Seis passos atômicos, cada um num serviço. Se um falha de vez, os anteriores são desfeitos em ordem reversa — estoque, cobrança e cupom voltam ao que eram.",
  },
  {
    title: "Fila durável no Postgres",
    body: "Pedido e job nascem na mesma transação (outbox). Workers concorrentes com SKIP LOCKED, lease com prazo, retry com backoff, dead-letter e reconciliação automática.",
  },
  {
    title: "Testado contra banco real",
    body: "Testes de integração no Postgres cobrindo compensação, retry, crash no meio do passo e concorrência. Um teste de arquitetura impede serviço de importar serviço.",
  },
  {
    title: "Pronto pra ficar exposto",
    body: "Limite de tentativas no login contado no banco, login que não revela quais e-mails existem, proteção de CSRF e headers de segurança.",
  },
];

const STACK = ["Next.js 16", "React 19", "TypeScript", "PostgreSQL", "Drizzle ORM", "Tailwind CSS 4", "node:test"];

export default function AboutPage() {
  const simulationEnabled = isCheckoutSimulationEnabled();

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-accent">Projeto de portfólio</p>
      <h1 className="mt-2 font-brand text-3xl font-bold uppercase tracking-tight sm:text-4xl">Sobre o Dystopia</h1>
      <p className="mt-4 max-w-2xl leading-relaxed text-foreground-muted">
        Uma loja geek fictícia construída pra mostrar o que acontece por trás de um botão de
        &ldquo;Finalizar pedido&rdquo;. A vitrine é o que você vê; o projeto de verdade é o checkout que
        não deixa pedido pela metade, mesmo quando o pagamento falha ou o servidor cai no meio.
      </p>

      <div className="mt-8 rounded-xl border border-accent/30 bg-accent/5 p-5">
        <h2 className="text-sm font-semibold">Experimente</h2>
        <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-foreground-muted">
          <li>
            <Link href="/entrar" className="font-medium text-accent hover:underline">
              Entre
            </Link>{" "}
            com a conta demo{" "}
            <code className="rounded bg-background-elevated px-1.5 py-0.5 font-mono text-xs text-foreground">
              cliente@dystopia.dev
            </code>{" "}
            /{" "}
            <code className="rounded bg-background-elevated px-1.5 py-0.5 font-mono text-xs text-foreground">
              cliente123
            </code>{" "}
            (ou crie a sua).
          </li>
          <li>Coloque algo no carrinho e finalize — nenhum pagamento real é processado.</li>
          {simulationEnabled ? (
            <li>
              No checkout, o <strong className="text-foreground">modo demonstração</strong> deixa você
              escolher o que o gateway responde. Tente &ldquo;Recusar pagamento&rdquo; ou &ldquo;Gateway fora
              do ar&rdquo; pra ver a compensação.
            </li>
          ) : null}
          <li>Na página do pedido, acompanhe a saga passo a passo.</li>
        </ol>
      </div>

      <section className="mt-12">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Por baixo do capô</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {HIGHLIGHTS.map((item) => (
            <div key={item.title} className="rounded-lg border border-border bg-background-elevated p-5">
              <h3 className="font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-foreground-muted">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Os passos do checkout</h2>
        <ol className="mt-4 overflow-hidden rounded-lg border border-border bg-background-elevated">
          {SAGA_STEPS.map((step, index) => (
            <li
              key={step.name}
              className="flex items-center gap-4 border-b border-border px-5 py-3 text-sm last:border-b-0"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 font-mono text-[11px] font-bold text-accent">
                {index + 1}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <span className="font-medium">{sagaStepLabel(step.name)}</span>
                <span className="text-xs text-foreground-muted sm:text-right">
                  {step.undo ? <>se falhar depois: {step.undo}</> : "último passo, só avisa"}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-12 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Stack</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {STACK.map((tech) => (
              <li key={tech} className="rounded-full border border-border px-3 py-1 text-xs text-foreground-muted">
                {tech}
              </li>
            ))}
          </ul>
        </div>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90"
        >
          Ver o código no GitHub →
        </a>
      </section>
    </div>
  );
}
