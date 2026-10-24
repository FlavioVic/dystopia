import type { Metadata } from "next";
import Link from "next/link";
import { Sector, buttonPrimary } from "@/components/Kit";
import { isCheckoutSimulationEnabled } from "@/lib/checkout-simulation";
import { getStripePublishableKey } from "@/lib/stripe-public";
import { sagaStepLabel } from "@/lib/saga-ui";

export const metadata: Metadata = {
  title: "Sobre o projeto",
  description:
    "DYSTOPIA é um projeto de portfólio de Flávio Victor: loja de hardware em Next.js com checkout orquestrado por SAGA.",
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
    title: "Pagamentos em processo próprio",
    body: "A saga fala com o serviço de pagamentos só por mensagem: comando com endereço de resposta, outbox dos dois lados e resposta aplicada uma vez. Fila no RabbitMQ, com retry por fila de espera e DLQ.",
  },
  {
    title: "Testado contra infraestrutura real",
    body: "Testes de integração no Postgres e no RabbitMQ cobrindo compensação, retry, DLQ, broker fora do ar, crash no meio do passo e concorrência. Um teste de arquitetura impede serviço de importar serviço.",
  },
  {
    title: "Pronto pra ficar exposto",
    body: "Limite de tentativas no login contado no banco, login que não revela quais e-mails existem, proteção de CSRF e headers de segurança.",
  },
];

const STACK = ["Next.js 16", "React 19", "TypeScript", "PostgreSQL", "Drizzle ORM", "Tailwind CSS 4", "node:test"];

export default function AboutPage() {
  const simulationEnabled = isCheckoutSimulationEnabled();
  const stripeEnabled = getStripePublishableKey() != null;

  return (
    <>
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <p className="label text-foreground-muted">Projeto de portfólio / Flávio Victor</p>
        <h1 className="display-2 mt-4 text-[26px] leading-[34px] sm:text-[40px] sm:leading-[48px]">Sobre o projeto</h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-foreground-muted">
          Uma loja de hardware e serviços técnicos, projetada e construída por Flávio Victor pra mostrar o que
          acontece por trás de um botão de &ldquo;Confirmar aquisição&rdquo;. A vitrine é o que você vê; o projeto
          de verdade é o checkout que não deixa pedido pela metade, mesmo quando o pagamento falha ou o servidor
          cai no meio.
        </p>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-foreground-muted">
          As peças são reais, com especificação de fabricante; os preços são fictícios e nada é cobrado. A
          identidade visual (o emblema, o nome desenhado, a voz) segue um design system próprio.
        </p>

        <div className="dys-frame mt-10 p-6">
          <h2 className="label text-foreground">Procedimento de teste</h2>
          <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-foreground-muted">
            <li>
              <Link href="/entrar" className="font-medium text-foreground underline underline-offset-4">
                Entre
              </Link>{" "}
              com a conta demo{" "}
              <code className="bg-background-elevated px-1.5 py-0.5 font-mono text-xs text-foreground">
                cliente@dystopia.dev
              </code>{" "}
              /{" "}
              <code className="bg-background-elevated px-1.5 py-0.5 font-mono text-xs text-foreground">
                cliente123
              </code>{" "}
              (ou crie a sua).
            </li>
            <li>
              Coloque uma peça no carrinho e confirme a aquisição. Nenhum pagamento real é processado.
              {stripeEnabled ? (
                <>
                  {" "}No cartão (Stripe em modo de teste), use{" "}
                  <span className="font-mono text-foreground">4242 4242 4242 4242</span> pra aprovar ou{" "}
                  <span className="font-mono text-foreground">4000 0000 0000 0002</span> pra ver a recusa.
                </>
              ) : null}
            </li>
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
      </div>

      <Sector tone="crimson" narrow>
        <h2 className="label text-foreground-muted">Por baixo do capô</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {HIGHLIGHTS.map((item) => (
            <div key={item.title} className="border border-border-faint bg-background-elevated p-5">
              <h3 className="font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-foreground-muted">{item.body}</p>
            </div>
          ))}
        </div>
      </Sector>

      <Sector tone="bone" narrow>
        <h2 className="label text-foreground-muted">Os passos do checkout</h2>
        <ol className="mt-4 border border-border-faint">
          {SAGA_STEPS.map((step, index) => (
            <li
              key={step.name}
              className="flex items-center gap-4 border-b border-border-faint px-5 py-3 text-sm last:border-b-0"
            >
              <span className="serial w-6 shrink-0 text-foreground-muted">
                {String(index + 1).padStart(2, "0")}
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
      </Sector>

      <Sector tone="graphite" narrow className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="label text-foreground-muted">Stack</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {STACK.map((tech) => (
              <li key={tech} className="dys-label dys-label--notice">
                {tech}
              </li>
            ))}
          </ul>
        </div>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className={buttonPrimary}
        >
          Código-fonte no GitHub
        </a>
      </Sector>
    </>
  );
}
