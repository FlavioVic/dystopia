"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Category = { slug: string; name: string };

const LINKS = [
  { href: "/servicos", label: "Serviços" },
  { href: "/portfolio", label: "Portfólio" },
];

function isActive(path: string, href: string): boolean {
  return path === href || path.startsWith(`${href}/`);
}

/** Busca no inventário (usada no menu da loja e no menu do celular). */
function StoreSearch() {
  return (
    <form action="/produtos" role="search" className="flex items-stretch">
      <input
        type="search"
        name="q"
        placeholder="Placa de vídeo, processador…"
        aria-label="Buscar no inventário"
        className="w-full min-w-0 border border-r-0 border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-foreground-muted focus:border-foreground"
      />
      <button type="submit" className="label bg-primary px-4 text-primary-foreground transition-colors hover:bg-primary-hover">
        Buscar
      </button>
    </form>
  );
}

/**
 * Navegação principal. Serviços vêm primeiro (é o foco do site); a loja abre
 * um menu com as categorias em vez de uma faixa rolável.
 */
export function HeaderNav({ categories }: { categories: Category[] }) {
  const path = usePathname();
  const [storeOpen, setStoreOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const storeRef = useRef<HTMLDivElement>(null);
  const storeActive = ["/produtos", "/produto", "/categoria"].some((p) => path.startsWith(p));

  // Fecha os menus ao navegar (ajuste durante a renderização, não em efeito:
  // é o padrão do React para estado que depende de prop/rota).
  const [lastPath, setLastPath] = useState(path);
  if (path !== lastPath) {
    setLastPath(path);
    setStoreOpen(false);
    setMobileOpen(false);
  }

  // ... e ao clicar fora / Esc.
  useEffect(() => {
    if (!storeOpen) return;
    const onClick = (event: MouseEvent) => {
      if (!storeRef.current?.contains(event.target as Node)) setStoreOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setStoreOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [storeOpen]);

  const linkClass = (active: boolean) =>
    `display-4 relative py-2 text-[12px] tracking-[0.16em] transition-colors after:absolute after:inset-x-0 after:-bottom-[15px] after:h-[2px] after:origin-left after:bg-primary after:transition-transform after:duration-300 ${
      active ? "text-foreground after:scale-x-100" : "text-foreground-muted after:scale-x-0 hover:text-foreground hover:after:scale-x-100"
    }`;

  return (
    <>
      {/* Desktop */}
      <nav aria-label="Principal" className="hidden items-center gap-8 lg:flex">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={linkClass(isActive(path, l.href))}>
            {l.label}
          </Link>
        ))}

        <div ref={storeRef} className="relative">
          <button
            type="button"
            aria-expanded={storeOpen}
            aria-controls="menu-loja"
            onClick={() => setStoreOpen((v) => !v)}
            className={`${linkClass(storeActive || storeOpen)} flex items-center gap-2`}
          >
            Loja
            <span aria-hidden="true" className={`inline-block transition-transform duration-200 ${storeOpen ? "rotate-180" : ""}`}>
              ▾
            </span>
          </button>

          <div
            id="menu-loja"
            className={`absolute left-1/2 top-[calc(100%+15px)] z-50 w-[640px] -translate-x-1/2 border border-border bg-background-elevated p-6 transition-all duration-200 ${
              storeOpen ? "visible translate-y-0 opacity-100" : "invisible -translate-y-2 opacity-0"
            }`}
          >
            <div className="h-[2px] w-12 bg-primary" aria-hidden="true" />
            <p className="label mt-4 text-foreground-muted">Inventário / {String(categories.length).padStart(2, "0")} categorias</p>
            <ul className="mt-4 grid grid-cols-2 gap-x-6">
              {categories.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/categoria/${c.slug}`}
                    className="group flex items-center justify-between border-b border-border-faint py-2.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
                  >
                    {c.name}
                    <span aria-hidden="true" className="text-signal-text opacity-0 transition-all duration-200 group-hover:translate-x-1 group-hover:opacity-100">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-5 grid grid-cols-[1fr_auto] items-center gap-4">
              <StoreSearch />
              <Link href="/produtos" className="label text-signal-text hover:text-foreground">
                Inventário completo
              </Link>
            </div>
          </div>
        </div>

        <Link href="/sobre" className={linkClass(isActive(path, "/sobre"))}>
          Sobre
        </Link>
      </nav>

      {/* Celular */}
      <div className="lg:hidden">
        <button
          type="button"
          aria-expanded={mobileOpen}
          aria-controls="menu-celular"
          onClick={() => setMobileOpen((v) => !v)}
          className="label flex items-center gap-2 border border-border px-3 py-2 text-foreground"
        >
          <span className="flex w-4 flex-col gap-[3px]" aria-hidden="true">
            <span className={`h-[2px] bg-foreground transition-transform ${mobileOpen ? "translate-y-[5px] rotate-45" : ""}`} />
            <span className={`h-[2px] bg-foreground transition-opacity ${mobileOpen ? "opacity-0" : ""}`} />
            <span className={`h-[2px] bg-foreground transition-transform ${mobileOpen ? "-translate-y-[5px] -rotate-45" : ""}`} />
          </span>
          {/* Em 320 px a palavra não cabe junto dos atalhos; o leitor de tela ainda a lê. */}
          <span className="max-[359px]:sr-only">Menu</span>
        </button>
        <div
          id="menu-celular"
          className={`fixed inset-x-0 top-16 z-50 max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-border bg-background px-4 pb-8 pt-6 transition-all duration-200 ${
            mobileOpen ? "visible opacity-100" : "invisible -translate-y-2 opacity-0"
          }`}
        >
          <nav aria-label="Principal (celular)" className="flex flex-col">
            {[...LINKS, { href: "/produtos", label: "Loja" }, { href: "/sobre", label: "Sobre" }].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`display-4 border-b border-border-faint py-4 text-[14px] ${isActive(path, l.href) ? "text-signal-text" : "text-foreground"}`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <p className="label mt-6 text-foreground-muted">Categorias</p>
          <ul className="mt-3 grid grid-cols-2 gap-x-4">
            {categories.map((c) => (
              <li key={c.slug}>
                <Link href={`/categoria/${c.slug}`} className="block border-b border-border-faint py-2.5 text-sm text-foreground-muted">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <StoreSearch />
          </div>
        </div>
      </div>
    </>
  );
}
