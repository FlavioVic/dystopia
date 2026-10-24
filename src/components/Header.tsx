import Link from "next/link";
import { HeaderNav } from "@/components/HeaderNav";
import { Emblem, Logo } from "@/components/Logo";

type Category = { slug: string; name: string };

function Count({ value }: { value: number }) {
  return <span className="font-mono text-foreground">{String(Math.min(value, 99)).padStart(2, "0")}</span>;
}

/**
 * Cabeçalho: marca, navegação principal (serviços primeiro) e atalhos de
 * conta e carrinho. A marca não tem conjunto de ícones: atalhos são rótulos.
 */
export function Header({
  categories,
  cartCount = 0,
  favoriteCount = 0,
  user = null,
}: {
  categories: Category[];
  cartCount?: number;
  favoriteCount?: number;
  user?: { name: string } | null;
}) {
  const shortcut = "label flex items-center gap-2 text-foreground-muted transition-colors hover:text-foreground";
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:gap-8 sm:px-6 lg:px-8">
        {/* No celular o lockup inteiro não cabe com os atalhos: fica o emblema. */}
        <Link href="/" aria-label="DYSTOPIA — início" className="shrink-0 text-foreground sm:hidden">
          <Emblem size={28} className="text-primary" />
        </Link>
        <span className="hidden sm:inline-flex">
          <Logo href="/" size={26} />
        </span>

        <HeaderNav categories={categories} />

        <nav aria-label="Atalhos" className="ml-auto flex shrink-0 items-center gap-4 sm:gap-5">
          {user ? (
            <>
              <Link href="/conta" className={shortcut}>
                <span className="hidden sm:inline">{user.name.split(" ")[0]}</span>
                <span className="sm:hidden">Conta</span>
              </Link>
              <Link href="/favoritos" className={`${shortcut} hidden md:flex`} aria-label={`Arquivo de favoritos (${favoriteCount})`}>
                Arquivo <Count value={favoriteCount} />
              </Link>
            </>
          ) : (
            <Link href="/entrar" className={shortcut}>
              Entrar
            </Link>
          )}
          <Link
            href="/carrinho"
            className={`${shortcut} border border-border px-3 py-2 hover:border-primary`}
            aria-label={`Carrinho (${cartCount} ${cartCount === 1 ? "item" : "itens"})`}
          >
            Carrinho <Count value={cartCount} />
          </Link>
        </nav>
      </div>
    </header>
  );
}
