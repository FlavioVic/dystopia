import { getCategories } from "@/lib/data/products";
import { PORTFOLIO, PROFILE } from "@/lib/portfolio";
import { PROCESS, SERVICE_FAQ, SERVICES } from "@/lib/services-catalog";
import { CONTACT_EMAIL, SITE_URL } from "@/lib/site";

/**
 * /llms.txt (llmstxt.org): o site em Markdown curto, para assistente de IA
 * responder sobre ele sem raspar o layout (GEO). Montado das mesmas fontes que
 * as páginas usam — serviço, FAQ e portfólio não ficam com duas versões.
 */

export const dynamic = "force-dynamic";

const link = (title: string, path: string, note?: string) => `- [${title}](${SITE_URL}${path})${note ? `: ${note}` : ""}`;

export async function GET(): Promise<Response> {
  const categories = await getCategories();

  const body = [
    "# DYSTOPIA",
    "",
    `> Desenvolvimento de software e serviços técnicos de computador (montagem, manutenção e formatação), por ${PROFILE.name}. Orçamento sem custo, por escrito, antes de qualquer intervenção. Inclui uma loja de peças de PC que é demonstração técnica: o pagamento é simulado e nenhum valor é cobrado.`,
    "",
    `Responsável: ${PROFILE.name}, ${PROFILE.role}. ${PROFILE.summary} Contato: ${CONTACT_EMAIL}.`,
    "",
    "## Serviços",
    "",
    ...SERVICES.map((s) => link(s.name, `/servicos#${s.kind}`, `${s.summary} Inclui: ${s.scope.join("; ")}.`)),
    link("Pedir orçamento", "/servicos#orcamento", "formulário; cada pedido recebe um protocolo DYS-S e o retorno é por e-mail"),
    "",
    "## Como funciona",
    "",
    ...PROCESS.map((p) => `${Number(p.step)}. ${p.title}: ${p.text}`),
    "",
    "## Perguntas frequentes",
    "",
    ...SERVICE_FAQ.flatMap((item) => [`### ${item.question}`, "", item.answer, ""]),
    "## Portfólio",
    "",
    ...PORTFOLIO.map((p) => `- ${p.name} (${p.year}): ${p.repo}`),
    link("Todos os projetos", "/portfolio"),
    "",
    "## Loja de demonstração",
    "",
    link("Inventário", "/produtos", "peças com ficha técnica; preços fictícios"),
    ...categories.map((c) => link(c.name, `/categoria/${c.slug}`)),
    "",
    "## Opcional",
    "",
    link("Sobre o projeto", "/sobre", "arquitetura: Next.js, PostgreSQL, checkout orquestrado por SAGA sobre RabbitMQ"),
    link("Política de privacidade", "/privacidade", "dados coletados e direitos do titular (LGPD)"),
    link("Créditos", "/creditos", "fotos e fontes"),
    "",
  ].join("\n");

  return new Response(body, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
