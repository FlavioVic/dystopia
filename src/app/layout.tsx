import type { Metadata } from "next";
import { headers } from "next/headers";
import { Assistant } from "@/components/Assistant";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PromoBar } from "@/components/PromoBar";
import { getCategories } from "@/lib/data/products";
import { getCartCount } from "@/lib/data/cart";
import { getCurrentUser } from "@/lib/data/auth";
import { getWishlistProductIds } from "@/lib/data/wishlist";
import { chatConfigFromEnv } from "@/lib/assistant/provider";
import { SITE_URL } from "@/lib/site";
import { interTight, michroma, plexMono } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "DYSTOPIA — hardware sob controle",
    template: "%s · DYSTOPIA",
  },
  description:
    "Peças de PC e serviços técnicos: montagem, manutenção, formatação e desenvolvimento de software, por Flávio Victor.",
  // URLs absolutas (Open Graph, canonical) a partir do domínio de produção.
  metadataBase: new URL(SITE_URL),
  keywords: [
    "montagem de computador",
    "manutenção de computador",
    "formatação de computador",
    "desenvolvimento de software",
    "peças de PC",
    "placa de vídeo",
    "Flávio Victor",
  ],
  authors: [{ name: "Flávio Victor", url: "https://github.com/FlavioVic" }],
  // Quem recebe o link compartilhado (LinkedIn, WhatsApp) vê o projeto, não só
  // a loja. A imagem vem de app/opengraph-image.tsx.
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "DYSTOPIA",
    title: "DYSTOPIA — software e hardware sob controle, por Flávio Victor",
    description:
      "Desenvolvimento de software, montagem, manutenção e formatação de computadores. Orçamento sem custo. Portfólio e loja de peças de PC.",
  },
  twitter: { card: "summary_large_image" },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Nonce da CSP (src/proxy.ts) para os <script> escritos à mão aqui.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const [categories, cartCount, user, favorites] = await Promise.all([
    getCategories(),
    getCartCount(),
    getCurrentUser(),
    getWishlistProductIds(),
  ]);

  return (
    <html
      lang="pt-BR"
      className={`h-full ${michroma.variable} ${interTight.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Liga a animação de "revelar" só quando há JS: sem isso, o conteúdo
            nunca fica escondido esperando um script que não vai rodar. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js-reveal')" }} />
        {/* Vercel Web Analytics (grátis no Hobby) pela integração por script, sem
            dependência nova. Só na Vercel: fora dela o endpoint não existe. */}
        {process.env.VERCEL === "1" ? (
          <>
            <script
              nonce={nonce}
              dangerouslySetInnerHTML={{
                __html: "window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};",
              }}
            />
            <script nonce={nonce} defer src="/_vercel/insights/script.js" />
          </>
        ) : null}
      </head>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <PromoBar />
        <Header
          categories={categories}
          cartCount={cartCount}
          favoriteCount={favorites.size}
          user={user}
        />
        <main className="flex-1">{children}</main>
        <Footer categories={categories} />
        {/* Sem CHAT_API_KEY o assistente não existe — nem o botão aparece. */}
        {chatConfigFromEnv() ? <Assistant /> : null}
      </body>
    </html>
  );
}
