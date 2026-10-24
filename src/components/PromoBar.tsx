import Link from "next/link";

/** Faixa de diretiva no topo: o vermelho de ação, com o chamado principal. */
export function PromoBar() {
  return (
    <div className="bg-primary text-primary-foreground">
      <div className="label mx-auto flex max-w-7xl items-center justify-center gap-x-4 gap-y-1 px-4 py-2 text-center">
        <span className="hidden sm:inline">Diretiva 01 / Orçamento sem custo para todo serviço</span>
        <span className="sm:hidden">Orçamento sem custo</span>
        <span aria-hidden="true" className="opacity-60">
          /
        </span>
        <Link href="/servicos#orcamento" className="underline underline-offset-4 hover:opacity-80">
          Solicitar agora
        </Link>
        <span aria-hidden="true" className="hidden opacity-60 md:inline">
          /
        </span>
        <span className="hidden md:inline">Loja: cupom BEMVINDO10 na primeira aquisição</span>
      </div>
    </div>
  );
}
