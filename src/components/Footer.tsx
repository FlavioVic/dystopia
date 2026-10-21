import Link from "next/link";
import { Logo } from "@/components/Logo";

type Category = { slug: string; name: string };

export function Footer({ categories }: { categories: Category[] }) {
  return (
    <footer className="mt-16 border-t border-border">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-4 lg:px-8">
        <div className="lg:col-span-2">
          <Logo href="/" />
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-foreground-muted">
            Loja geek de um futuro que ainda não deu certo. Colecionáveis, quadrinhos,
            games e moda pra quem vive entre o analógico e o neon.
          </p>
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
            Categorias
          </h4>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {categories.slice(0, 5).map((c) => (
              <li key={c.slug}>
                <Link href={`/categoria/${c.slug}`} className="text-foreground-muted hover:text-foreground">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Ajuda</h4>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-foreground-muted">
            <li>Trocas e devoluções</li>
            <li>Prazos de entrega</li>
            <li>Fale conosco</li>
          </ul>
        </div>
      </div>

      <div className="border-t border-border px-4 py-6 text-center text-xs text-foreground-muted sm:px-6 lg:px-8">
        Dystopia — projeto de portfólio. Produtos e marca fictícios.
      </div>
    </footer>
  );
}
