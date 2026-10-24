import Link from "next/link";
import { pageCount } from "@/lib/pagination";

/**
 * Navegação entre páginas de uma listagem. Server Component, só links: a
 * página é parte da URL (`?pagina=`), então volta, compartilha e indexa. Os
 * outros parâmetros (a busca, `q`) são preservados.
 */
export function Pagination({
  basePath,
  page,
  total,
  pageSize,
  params = {},
}: {
  basePath: string;
  page: number;
  total: number;
  pageSize: number;
  params?: Record<string, string>;
}) {
  const pages = pageCount(total, pageSize);
  if (pages <= 1) return null;

  const href = (target: number) => {
    const search = new URLSearchParams(params);
    if (target > 1) search.set("pagina", String(target));
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  // Primeira, última e as vizinhas da atual; o resto vira reticências.
  const shown = [...new Set([1, page - 1, page, page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const cell = "label inline-flex min-w-10 items-center justify-center border px-3 py-2";

  return (
    <nav aria-label="Paginação" className="mt-10 flex flex-wrap items-center gap-2">
      {page > 1 ? (
        <Link href={href(page - 1)} className={`${cell} border-border hover:border-foreground`} rel="prev">
          Anterior
        </Link>
      ) : null}
      {shown.map((n, i) => (
        <span key={n} className="contents">
          {i > 0 && n - shown[i - 1] > 1 ? <span className="label px-1 text-foreground-muted">…</span> : null}
          {n === page ? (
            <span aria-current="page" className={`${cell} border-foreground bg-foreground text-background`}>
              {String(n).padStart(2, "0")}
            </span>
          ) : (
            <Link href={href(n)} className={`${cell} border-border hover:border-foreground`}>
              {String(n).padStart(2, "0")}
            </Link>
          )}
        </span>
      ))}
      {page < pages ? (
        <Link href={href(page + 1)} className={`${cell} border-border hover:border-foreground`} rel="next">
          Próxima
        </Link>
      ) : null}
    </nav>
  );
}
