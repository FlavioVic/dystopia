import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PromoBar } from "@/components/PromoBar";
import { getCategories } from "@/lib/data/products";
import { getCartCount } from "@/lib/data/cart";
import { getCurrentUser } from "@/lib/data/auth";
import { getWishlistProductIds } from "@/lib/data/wishlist";
import { chakraPetch } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Dystopia — loja geek",
    template: "%s · Dystopia",
  },
  description: "Colecionáveis, quadrinhos, games e moda geek de um futuro cyberpunk.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [categories, cartCount, user, favorites] = await Promise.all([
    getCategories(),
    getCartCount(),
    getCurrentUser(),
    getWishlistProductIds(),
  ]);

  return (
    <html lang="pt-BR" className={`h-full antialiased ${chakraPetch.variable}`}>
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
