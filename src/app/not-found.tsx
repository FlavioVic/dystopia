import type { Metadata } from "next";
import Link from "next/link";
import { ClassLabel, Sector, buttonPrimary, buttonSecondary } from "@/components/Kit";

export const metadata: Metadata = { title: "Registro inexistente" };

/** 404 da loja inteira: `notFound()` em qualquer rota e URL que não existe. */
export default function NotFound() {
  return (
    <Sector tone="crimson" narrow className="flex min-h-[50vh] flex-col justify-center gap-6">
      <ClassLabel level="restricted">Erro 404</ClassLabel>
      <h1 className="display-2 text-[26px] leading-[34px] sm:text-[40px] sm:leading-[48px]">Registro inexistente</h1>
      <p className="max-w-xl text-base leading-relaxed text-foreground-muted">
        O endereço consultado não consta no arquivo. Pode ter sido removido, ou nunca ter existido.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/produtos" className={buttonPrimary}>
          Consultar inventário
        </Link>
        <Link href="/" className={buttonSecondary}>
          Voltar ao início
        </Link>
      </div>
    </Sector>
  );
}
