"use client";

import Link from "next/link";
import { ClassLabel, Sector, buttonPrimary, buttonSecondary } from "@/components/Kit";
import { errorDigest } from "@/lib/error-digest";

/**
 * Falha inesperada ao renderizar uma página (banco fora, bug). Em produção o
 * Next não manda a mensagem original para o navegador — só o `digest`, que é o
 * que cruza esta tela com a linha do log no servidor.
 */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = errorDigest(error);

  return (
    <Sector tone="graphite" narrow className="flex min-h-[50vh] flex-col justify-center gap-6">
      <ClassLabel level="restricted">Falha de sistema</ClassLabel>
      <h1 className="display-2 text-[26px] leading-[34px] sm:text-[40px] sm:leading-[48px]">Operação interrompida</h1>
      <p className="max-w-xl text-base leading-relaxed text-foreground-muted">
        A página não pôde ser montada agora. Nenhum dado foi perdido: pedidos em andamento seguem sendo processados.
      </p>
      {digest ? <p className="serial text-foreground-muted">Ocorrência {digest}</p> : null}
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => retry()} className={buttonPrimary}>
          Tentar de novo
        </button>
        <Link href="/" className={buttonSecondary}>
          Voltar ao início
        </Link>
      </div>
    </Sector>
  );
}
