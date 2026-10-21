import Link from "next/link";
import { Logo } from "@/components/Logo";

type Category = { slug: string; name: string };

function SearchForm({ className = "" }: { className?: string }) {
  return (
    <form action="/produtos" role="search" className={`flex items-stretch ${className}`}>
      <input
        type="search"
        name="q"
        placeholder="Buscar colecionáveis, quadrinhos, games…"
        aria-label="Buscar produtos"
        className="w-full rounded-l-lg border border-r-0 border-border bg-background px-3.5 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-foreground-muted focus:border-accent"
      />
      <button
        type="submit"
        aria-label="Buscar"
        className="flex items-center justify-center rounded-r-lg bg-accent px-3.5 text-accent-foreground transition-colors hover:bg-accent/90"
      >
        <svg viewBox="0 0 20 20" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="9" cy="9" r="6" />
          <path d="M14 14l4 4" strokeLinecap="round" />
        </svg>
      </button>
    </form>
  );
}

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
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Logo href="/" />

        <SearchForm className="ml-2 hidden max-w-xl flex-1 md:flex" />

        <div className="ml-auto flex shrink-0 items-center gap-4">
          {user ? (
            <Link
              href="/conta"
              className="flex items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75">
                <circle cx="12" cy="8" r="3.2" />
                <path d="M5.5 19a6.5 6.5 0 0 1 13 0" strokeLinecap="round" />
              </svg>
              <span className="hidden max-w-24 truncate lg:inline">{user.name.split(" ")[0]}</span>
            </Link>
          ) : (
            <Link
              href="/entrar"
              className="flex items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75">
                <circle cx="12" cy="8" r="3.2" />
                <path d="M5.5 19a6.5 6.5 0 0 1 13 0" strokeLinecap="round" />
              </svg>
              <span className="hidden sm:inline">Entrar</span>
            </Link>
          )}

          {user ? (
            <Link
              href="/favoritos"
              className="relative flex h-9 w-9 items-center justify-center rounded-md border border-border text-foreground-muted transition-colors hover:border-border-hover hover:text-accent"
              aria-label={
                favoriteCount > 0
                  ? `Favoritos (${favoriteCount} ${favoriteCount === 1 ? "produto" : "produtos"})`
                  : "Favoritos"
              }
            >
              <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path
                  d="M12 20s-7-4.3-7-9.3A4 4 0 0 1 12 7.8a4 4 0 0 1 7 2.9c0 5-7 9.3-7 9.3z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {favoriteCount > 0 ? (
                <span className="absolute -right-1.5 -top-1.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-accent-secondary px-1 font-mono text-[10px] font-semibold leading-none text-white">
                  {favoriteCount > 99 ? "99+" : favoriteCount}
                </span>
              ) : null}
            </Link>
          ) : null}

          <Link
            href="/carrinho"
            className="relative flex h-9 w-9 items-center justify-center rounded-md border border-border text-foreground-muted transition-colors hover:border-border-hover hover:text-foreground"
            aria-label={cartCount > 0 ? `Carrinho (${cartCount} ${cartCount === 1 ? "item" : "itens"})` : "Carrinho"}
          >
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path
                d="M3 3h1.5l1.3 12.2a2 2 0 0 0 2 1.8h8.9a2 2 0 0 0 2-1.7L20 8H6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="9.5" cy="20" r="1.3" fill="currentColor" stroke="none" />
              <circle cx="17" cy="20" r="1.3" fill="currentColor" stroke="none" />
            </svg>
            {cartCount > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] font-semibold leading-none text-accent-foreground">
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            ) : null}
          </Link>
        </div>
      </div>

      {/* Busca (mobile) */}
      <div className="px-4 pb-3 sm:px-6 md:hidden">
        <SearchForm />
      </div>

      {/* Navegação de categorias */}
      <nav className="border-t border-border/70">
        <div className="mx-auto flex max-w-7xl gap-5 overflow-x-auto px-4 py-2.5 text-sm sm:px-6 lg:px-8">
          <Link
            href="/produtos"
            className="whitespace-nowrap font-medium text-foreground transition-colors hover:text-accent"
          >
            Todos
          </Link>
          {categories.map((c) => (
            <Link
              key={c.slug}
              href={`/categoria/${c.slug}`}
              className="whitespace-nowrap text-foreground-muted transition-colors hover:text-accent"
            >
              {c.name}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
