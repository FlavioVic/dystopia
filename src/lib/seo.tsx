/**
 * Dados estruturados (schema.org em JSON-LD) e metadados repetidos entre
 * páginas. É o que buscador e assistente de IA leem para saber QUEM é o site
 * (organização, autor), O QUE ele oferece (serviços) e como as páginas se
 * ligam (trilha) — sem depender de interpretar o layout.
 *
 * A loja é demonstração (nada é cobrado): produto entra como entidade, sem
 * `Offer` com preço — marcar oferta faria o buscador anunciar venda que não
 * existe. Serviço é real e entra completo.
 */

import type { Metadata } from "next";
import { PROFILE } from "@/lib/portfolio";
import { CONTACT_EMAIL, SITE_URL } from "@/lib/site";

const ORG_ID = `${SITE_URL}/#organizacao`;
const PERSON_ID = `${SITE_URL}/#flavio-victor`;

/** `<script type="application/ld+json">`. `<` escapado: texto do banco não fecha a tag. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify({ "@context": "https://schema.org", ...data }).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}

export const absoluteUrl = (path: string) => `${SITE_URL}${path}`;

/** Organização + autor + site (com a busca do inventário). Vai em toda página. */
export function siteGraph(): Record<string, unknown> {
  return {
    "@graph": [
      {
        "@type": "Organization",
        "@id": ORG_ID,
        name: "DYSTOPIA",
        url: SITE_URL,
        logo: absoluteUrl("/icon.svg"),
        email: CONTACT_EMAIL,
        founder: { "@id": PERSON_ID },
        description:
          "Desenvolvimento de software, montagem, manutenção e formatação de computadores, por Flávio Victor.",
        sameAs: [PROFILE.github, PROFILE.linkedin],
      },
      {
        "@type": "Person",
        "@id": PERSON_ID,
        name: PROFILE.name,
        jobTitle: PROFILE.role,
        description: PROFILE.summary,
        url: absoluteUrl("/portfolio"),
        sameAs: [PROFILE.github, PROFILE.linkedin],
        worksFor: { "@id": ORG_ID },
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#site`,
        url: SITE_URL,
        name: "DYSTOPIA",
        inLanguage: "pt-BR",
        publisher: { "@id": ORG_ID },
        potentialAction: {
          "@type": "SearchAction",
          target: { "@type": "EntryPoint", urlTemplate: `${SITE_URL}/produtos?q={termo}` },
          "query-input": "required name=termo",
        },
      },
    ],
  };
}

export function breadcrumb(items: { name: string; path: string }[]): Record<string, unknown> {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function serviceEntity(service: { kind: string; name: string; summary: string; scope: string[] }) {
  return {
    "@type": "Service",
    "@id": absoluteUrl(`/servicos#${service.kind}`),
    name: service.name,
    description: `${service.summary} Inclui: ${service.scope.join("; ")}.`,
    serviceType: service.name,
    provider: { "@id": ORG_ID },
    areaServed: { "@type": "Country", name: "Brasil" },
    offers: {
      "@type": "Offer",
      description: "Orçamento sem custo, enviado por escrito antes de qualquer execução.",
      url: absoluteUrl("/servicos#orcamento"),
    },
  };
}

export function faqPage(items: { question: string; answer: string }[]): Record<string, unknown> {
  return {
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

/** Página que não deve aparecer em busca (área logada, carrinho, formulários). */
export const PRIVATE_PAGE: Metadata["robots"] = { index: false, follow: false };

/** Canonical relativo (o `metadataBase` do layout completa o domínio). */
export const canonical = (path: string): Metadata["alternates"] => ({ canonical: path });

/** Canonical de listagem paginada: cada página é ela mesma; a 1 não leva `?pagina`. */
export function listingCanonical(path: string, pagina: string | string[] | undefined): Metadata["alternates"] {
  const page = Number(Array.isArray(pagina) ? pagina[0] : pagina);
  return canonical(Number.isInteger(page) && page > 1 ? `${path}?pagina=${page}` : path);
}
