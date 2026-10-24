import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PromoBar } from "@/components/PromoBar";
import { getCategories } from "@/lib/data/products";
import { getCartCount } from "@/lib/data/cart";
import { getCurrentUser } from "@/lib/data/auth";
import { getWishlistProductIds } from "@/lib/data/wishlist";
import { interTight, michroma, plexMono } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "DYSTOPIA — hardware sob controle",
    template: "%s · DYSTOPIA",
  },
  description:
    "Peças de PC e serviços técnicos: montagem, manutenção, formatação e desenvolvimento de software, por Flávio Victor.",
  // Quem recebe o link compartilhado (LinkedIn, WhatsApp) vê o projeto, não só
  // a loja. A imagem vem de app/opengraph-image.tsx; na Vercel o Next monta a
  // URL absoluta com o domínio de produção (sem metadataBase fixo).
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "DYSTOPIA",
    title: "DYSTOPIA — loja de hardware com checkout orquestrado por SAGA",
    description:
      "Projeto de portfólio de Flávio Victor: e-commerce de peças de PC em Next.js + Postgres, com fila durável, compensação, observabilidade e serviços técnicos.",
  },
  twitter: { card: "summary_large_image" },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
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
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js-reveal')" }} />
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
      </body>
    </html>
  );
}
