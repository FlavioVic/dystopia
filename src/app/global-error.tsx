"use client";

import { errorDigest } from "@/lib/error-digest";
import { interTight, michroma, plexMono } from "./fonts";
import "./globals.css";

/**
 * Última linha de defesa: falha no próprio layout raiz (header, sessão,
 * categorias). Substitui o layout inteiro, então traz o próprio <html>, CSS e
 * fontes — e não usa nada que dependa do banco.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = errorDigest(error);

  return (
    <html lang="pt-BR" className={`h-full ${michroma.variable} ${interTight.variable} ${plexMono.variable}`}>
      <body className="flex min-h-full flex-col items-start justify-center gap-6 bg-background px-6 text-foreground sm:px-16">
        <title>Falha de sistema · DYSTOPIA</title>
        <p className="label text-foreground-muted">DYSTOPIA / Falha de sistema</p>
        <h1 className="display-2 text-[26px] leading-[34px] sm:text-[40px] sm:leading-[48px]">Sistema indisponível</h1>
        <p className="max-w-xl text-base leading-relaxed text-foreground-muted">
          A loja não pôde ser carregada agora. Nenhum dado foi perdido.
        </p>
        {digest ? <p className="serial text-foreground-muted">Ocorrência {digest}</p> : null}
        <button
          type="button"
          onClick={() => retry()}
          className="label bg-primary px-5 py-3 text-primary-foreground hover:bg-primary-hover"
        >
          Tentar de novo
        </button>
      </body>
    </html>
  );
}
