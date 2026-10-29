import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Sector, buttonPrimary, buttonSecondary, gridCell, gridFrame } from "@/components/Kit";
import { isCheckoutSimulationEnabled } from "@/lib/checkout-simulation";
import { getCategories } from "@/lib/data/products";
import { INSTALLMENT_COUNT, INSTALLMENT_MIN_CENTS, formatPriceCents } from "@/lib/format";
import { PROFILE } from "@/lib/portfolio";
import { canonical } from "@/lib/seo";
import { PROCESS, SERVICES } from "@/lib/services-catalog";
import { FLAT_SHIPPING_CENTS, FREE_SHIPPING_MIN_CENTS } from "@/lib/shipping";
import { CONTACT_EMAIL } from "@/lib/site";
import { getStripePublishableKey } from "@/lib/stripe-public";

export const metadata: Metadata = {
  title: "Sobre a loja",
  description:
    "A DYSTOPIA vende peças de computador e presta serviços técnicos: montagem, manutenção, formatação e desenvolvimento de software, com orçamento sem custo.",
  alternates: canonical("/sobre"),
};

/**
 * Sobre a LOJA (o que vende, como atende, o que garante, quem atende). Como
 * ela foi construída mora no portfólio e no README. Cada compromisso aqui sai
 * de uma regra que o código aplica — mudou a regra, muda o texto.
 */
export default async function AboutPage() {
  const categories = await getCategories();
  const simulationEnabled = isCheckoutSimulationEnabled();
  const stripeEnabled = getStripePublishableKey() != null;

  const commitments = [
    { title: "Orçamento sem custo", text: "Todo serviço começa com um orçamento por escrito, com prazo e preço, antes de qualquer intervenção." },
    {
      title: "Frete grátis",
      text: `Em compras a partir de ${formatPriceCents(FREE_SHIPPING_MIN_CENTS)}. Abaixo disso, frete fixo de ${formatPriceCents(FLAT_SHIPPING_CENTS)}.`,
    },
    {
      title: `Até ${INSTALLMENT_COUNT}x sem juros`,
      text: `No cartão, em compras a partir de ${formatPriceCents(INSTALLMENT_MIN_CENTS)}. Também Pix e boleto.`,
    },
    { title: "Pedido acompanhado", text: "Cada etapa da compra aparece na página do pedido: estoque, pagamento, confirmação e aviso por e-mail." },
    { title: "Nada fica pela metade", text: "Se o pagamento é recusado, o pedido é desfeito por inteiro: o estoque volta e nada é cobrado." },
    { title: "Seus dados são seus", text: "Você baixa tudo o que a loja guarda sobre você ou exclui a conta, a qualquer momento." },
  ];

  return (
    <>
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <PageHeader
          label="Registro / Sobre a loja"
          title="A ordem é um serviço"
          description="A DYSTOPIA vende peças de computador e presta serviços técnicos: montagem, manutenção, formatação e desenvolvimento de software. Cada intervenção é registrada do pedido à entrega."
        />
      </div>

      <Sector tone="graphite" narrow>
        <h2 className="label text-foreground-muted">O que a loja faz</h2>
        <div className={`mt-4 grid-cols-1 sm:grid-cols-2 ${gridFrame}`}>
          <div className={`flex min-w-0 flex-col gap-4 bg-background p-6 ${gridCell}`}>
            <h3 className="display-4 text-[13px]">Hardware</h3>
            <p className="text-sm leading-relaxed text-foreground-muted">
              Peças com ficha técnica do fabricante, separadas por categoria.
            </p>
            <ul className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <li key={category.slug}>
                  <Link href={`/categoria/${category.slug}`} className="dys-label dys-label--notice hover:border-foreground hover:text-foreground">
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
            <Link href="/produtos" className={`mt-auto self-start ${buttonSecondary}`}>
              Ver inventário <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className={`flex min-w-0 flex-col gap-4 bg-background p-6 ${gridCell}`}>
            <h3 className="display-4 text-[13px]">Serviços técnicos</h3>
            <ul className="flex flex-col gap-3">
              {SERVICES.map((service) => (
                <li key={service.kind}>
                  <Link href={`/servicos?servico=${service.kind}#orcamento`} className="font-medium text-foreground underline underline-offset-4 hover:text-signal-text">
                    {service.name}
                  </Link>
                  <p className="mt-0.5 text-sm text-foreground-muted">{service.summary}</p>
                </li>
              ))}
            </ul>
            <Link href="/servicos#orcamento" className={`mt-auto self-start ${buttonPrimary}`}>
              Solicitar orçamento
            </Link>
          </div>
        </div>
      </Sector>

      <Sector tone="bone" narrow>
        <h2 className="label text-foreground-muted">Como o atendimento funciona</h2>
        <ol className="mt-4 border border-border-faint">
          {PROCESS.map((step) => (
            <li key={step.step} className="flex gap-4 border-b border-border-faint px-5 py-4 last:border-b-0">
              <span className="serial w-6 shrink-0 pt-0.5 text-foreground-muted">{step.step}</span>
              <span className="min-w-0">
                <span className="block font-medium">{step.title}</span>
                <span className="block text-sm text-foreground-muted">{step.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </Sector>

      <Sector tone="crimson" narrow>
        <h2 className="label text-foreground-muted">Compromissos da loja</h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {commitments.map((item) => (
            <li key={item.title} className="border border-border-faint bg-background-elevated p-5">
              <h3 className="font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-foreground-muted">{item.text}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-foreground-muted">
          Detalhes sobre dados pessoais na{" "}
          <Link href="/privacidade" className="text-foreground underline underline-offset-4">
            política de privacidade
          </Link>
          .
        </p>
      </Sector>

      <Sector tone="graphite" narrow>
        <h2 className="label text-foreground-muted">Quem atende</h2>
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-lg font-semibold">{PROFILE.name}</p>
          <p className="label text-signal-text">{PROFILE.role}</p>
          <p className="max-w-2xl text-sm leading-relaxed text-foreground-muted">
            {PROFILE.summary} Monta, mantém e restaura computadores, e desenvolve sistemas sob medida, da interface ao
            servidor.
          </p>
          <p className="text-sm text-foreground-muted">
            Contato:{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="break-all text-foreground underline underline-offset-4">
              {CONTACT_EMAIL}
            </a>
          </p>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/portfolio" className="label text-foreground underline underline-offset-4 hover:text-signal-text">
              Portfólio
            </Link>
            <a href={PROFILE.linkedin} target="_blank" rel="noreferrer" className="label text-foreground underline underline-offset-4 hover:text-signal-text">
              LinkedIn
            </a>
            <a href={PROFILE.github} target="_blank" rel="noreferrer" className="label text-foreground underline underline-offset-4 hover:text-signal-text">
              GitHub
            </a>
          </div>
        </div>
      </Sector>

      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="dys-frame p-6">
          <h2 className="label text-foreground">Loja de demonstração</h2>
          <p className="mt-3 text-sm leading-relaxed text-foreground-muted">
            As peças são reais, com especificação de fabricante, mas os preços são fictícios e nenhum pagamento real é
            processado. Para testar uma compra:
          </p>
          <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-foreground-muted">
            <li>
              <Link href="/entrar" className="font-medium text-foreground underline underline-offset-4">
                Entre
              </Link>{" "}
              com a conta demo{" "}
              <code className="bg-background-elevated px-1.5 py-0.5 font-mono text-xs text-foreground">cliente@dystopia.dev</code> /{" "}
              <code className="bg-background-elevated px-1.5 py-0.5 font-mono text-xs text-foreground">cliente123</code> (ou crie a sua).
            </li>
            <li>
              Coloque uma peça no carrinho e confirme a aquisição.
              {stripeEnabled ? (
                <>
                  {" "}No cartão (Stripe em modo de teste), use{" "}
                  <span className="font-mono text-foreground">4242 4242 4242 4242</span> para aprovar ou{" "}
                  <span className="font-mono text-foreground">4000 0000 0000 0002</span> para ver a recusa.
                </>
              ) : null}
            </li>
            {simulationEnabled ? (
              <li>
                No checkout, o <strong className="text-foreground">modo demonstração</strong> deixa você escolher o que o
                pagamento responde, para ver o pedido ser desfeito quando ele falha.
              </li>
            ) : null}
            <li>Na página do pedido, acompanhe cada etapa.</li>
          </ol>
          <p className="mt-4 text-sm text-foreground-muted">
            Como a loja foi construída está no{" "}
            <Link href="/portfolio#dystopia" className="text-foreground underline underline-offset-4">
              portfólio
            </Link>
            .
          </p>
        </div>
      </div>
    </>
  );
}
