import Link from "next/link";
import { Logo } from "@/components/Logo";
import { SERVICES } from "@/lib/services-catalog";
import { CONTACT_EMAIL } from "@/lib/site";

type Category = { slug: string; name: string };

export function Footer({ categories }: { categories: Category[] }) {
  const heading = "label text-foreground-muted";
  const item = "inline-block py-0.5 text-sm text-foreground-muted hover:text-foreground";
  return (
    <footer className="mt-24 border-t border-border">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-14 sm:px-6 lg:grid-cols-12 lg:px-8">
        <div className="lg:col-span-5">
          <Logo href="/" size={32} />
          <p className="display-4 mt-8 text-[12px] text-foreground">A ordem é um serviço.</p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-foreground-muted">
            Hardware registrado e serviços técnicos. Montagem, manutenção, formatação e desenvolvimento de
            software. Nada é perdido. Tudo é arquivado.
          </p>
        </div>

        <div className="lg:col-span-3">
          <h2 className={heading}>Inventário</h2>
          <ul className="mt-4 flex flex-col gap-2">
            {categories.map((c) => (
              <li key={c.slug}>
                <Link href={`/categoria/${c.slug}`} className={item}>
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="lg:col-span-2">
          <h2 className={heading}>Serviços</h2>
          <ul className="mt-4 flex flex-col gap-2">
            {SERVICES.map((s) => (
              <li key={s.kind}>
                <Link href={`/servicos#${s.kind}`} className={item}>
                  {s.name}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/servicos#orcamento" className={item}>
                Solicitar orçamento
              </Link>
            </li>
          </ul>
        </div>

        <div className="lg:col-span-2">
          <h2 className={heading}>Registro</h2>
          <ul className="mt-4 flex flex-col gap-2">
            <li>
              <Link href="/conta" className={item}>
                Sua ficha
              </Link>
            </li>
            <li>
              <Link href="/carrinho" className={item}>
                Carrinho
              </Link>
            </li>
            <li>
              <Link href="/sobre" className={item}>
                Sobre o projeto
              </Link>
            </li>
            <li>
              <Link href="/portfolio" className={item}>
                Portfólio
              </Link>
            </li>
            <li>
              <Link href="/creditos" className={item}>
                Créditos
              </Link>
            </li>
            <li>
              <Link href="/privacidade" className={item}>
                Privacidade
              </Link>
            </li>
            <li>
              <a href={`mailto:${CONTACT_EMAIL}`} className={`${item} break-all`}>
                {CONTACT_EMAIL}
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-border-faint">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p className="text-[13px] text-foreground-muted">
            Projetado e construído por <span className="text-foreground">Flávio Victor</span>.{" "}
            <Link href="/sobre" className="underline underline-offset-4 hover:text-foreground">
              Projeto de portfólio
            </Link>
            : nenhuma cobrança é real. Marcas pertencem aos fabricantes; preços são fictícios.
          </p>
          <p className="serial text-foreground-muted">DYS-0001 / SETOR 04</p>
        </div>
      </div>
    </footer>
  );
}
