"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/admin", label: "Painel" },
  { href: "/admin/pedidos", label: "Pedidos" },
  { href: "/admin/produtos", label: "Produtos" },
  { href: "/admin/cupons", label: "Cupons" },
  { href: "/admin/orcamentos", label: "Orçamentos" },
  { href: "/admin/orquestracao", label: "Orquestração" },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="flex min-w-0 gap-1 overflow-x-auto">
      {links.map((l) => {
        const active = l.href === "/admin" ? path === "/admin" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`label whitespace-nowrap border-b-2 px-3 py-2 ${
              active ? "border-foreground text-foreground" : "border-transparent text-foreground-muted hover:text-foreground"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
