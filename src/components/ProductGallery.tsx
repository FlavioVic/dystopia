"use client";

import { useRef, useState, type TouchEvent } from "react";
import Image from "next/image";
import { isTechnicalPlate } from "@/lib/product-media";

type GalleryImage = { url: string; altText: string | null; credit?: { author: string; license: string; source: string } };

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Galeria da página do produto (até 10 fotos, ver services/catalog/images.ts):
 * setas e contador na foto grande, miniaturas que rolam de lado no celular, e
 * clique na foto para ver em tela cheia — com as mesmas setas, teclado (← → e
 * Esc) e deslizar o dedo. A tela cheia é um <dialog> nativo: foco preso nele
 * e devolvido ao fechar, sem biblioteca.
 */
export function ProductGallery({ images, productName }: { images: GalleryImage[]; productName: string }) {
  const [active, setActive] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const touchX = useRef<number | null>(null);
  const count = images.length;
  const current = images[active] ?? images[0];
  const many = count > 1;

  const go = (delta: number) => setActive((index) => (index + delta + count) % count);
  const fit = (url: string) => (isTechnicalPlate(url) ? "object-cover" : "object-contain p-4");
  const swipe = {
    onTouchStart: (event: TouchEvent) => {
      touchX.current = event.touches[0].clientX;
    },
    onTouchEnd: (event: TouchEvent) => {
      if (touchX.current === null || !many) return;
      const dx = event.changedTouches[0].clientX - touchX.current;
      touchX.current = null;
      if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    },
  };
  const arrow = "label absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center border border-border bg-background/90 text-foreground transition-colors hover:border-foreground";

  if (!current) return <div className="aspect-square border border-border-faint bg-background" />;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="relative aspect-square overflow-hidden border border-border-faint bg-background" {...swipe}>
        <button
          type="button"
          onClick={() => dialogRef.current?.showModal()}
          className="absolute inset-0 cursor-zoom-in"
          aria-label={many ? `Ampliar imagem ${active + 1} de ${count}` : "Ampliar imagem"}
        >
          <Image
            src={current.url}
            alt={current.altText ?? productName}
            fill
            priority
            sizes="(min-width: 1024px) 40vw, 90vw"
            className={fit(current.url)}
          />
        </button>
        {many ? (
          <>
            <button type="button" onClick={() => go(-1)} className={`${arrow} left-2`} aria-label="Imagem anterior">
              ←
            </button>
            <button type="button" onClick={() => go(1)} className={`${arrow} right-2`} aria-label="Próxima imagem">
              →
            </button>
            <span className="label pointer-events-none absolute bottom-2 right-2 bg-background/90 px-2 py-1 text-foreground" aria-live="polite">
              {pad(active + 1)} / {pad(count)}
            </span>
          </>
        ) : null}
      </div>

      {current.credit ? <Credit credit={current.credit} /> : null}

      {many ? (
        <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Imagens do produto">
          {images.map((img, i) => (
            <li key={img.url + i} className="shrink-0">
              <button
                type="button"
                onClick={() => setActive(i)}
                className={`relative block h-16 w-16 overflow-hidden border ${
                  i === active ? "border-foreground" : "border-border-faint hover:border-border"
                }`}
                aria-label={`Ver imagem ${i + 1} de ${count}`}
                aria-current={i === active ? "true" : undefined}
              >
                <Image src={img.url} alt="" fill sizes="64px" className={isTechnicalPlate(img.url) ? "object-cover" : "object-contain p-1"} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <dialog
        ref={dialogRef}
        aria-label={`${productName}: imagens`}
        className="m-0 h-dvh max-h-none w-dvw max-w-none bg-background p-0 text-foreground backdrop:bg-background/90"
        onKeyDown={(event) => {
          if (!many) return;
          if (event.key === "ArrowLeft") go(-1);
          if (event.key === "ArrowRight") go(1);
        }}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <p className="label min-w-0 truncate text-foreground-muted">
              {many ? `${pad(active + 1)} / ${pad(count)} · ` : ""}
              {productName}
            </p>
            <button type="button" onClick={() => dialogRef.current?.close()} className="label shrink-0 border border-border px-3 py-2 hover:border-foreground" autoFocus>
              Fechar
            </button>
          </div>
          <div className="relative min-h-0 flex-1" {...swipe}>
            <Image src={current.url} alt={current.altText ?? productName} fill sizes="100vw" className="object-contain p-4 sm:p-10" />
            {many ? (
              <>
                <button type="button" onClick={() => go(-1)} className={`${arrow} left-3`} aria-label="Imagem anterior">
                  ←
                </button>
                <button type="button" onClick={() => go(1)} className={`${arrow} right-3`} aria-label="Próxima imagem">
                  →
                </button>
              </>
            ) : null}
          </div>
          {current.altText || current.credit ? (
            <div className="border-t border-border px-4 py-3 text-sm text-foreground-muted">
              {current.altText ? <p>{current.altText}</p> : null}
              {current.credit ? <Credit credit={current.credit} /> : null}
            </div>
          ) : null}
        </div>
      </dialog>
    </div>
  );
}

function Credit({ credit }: { credit: NonNullable<GalleryImage["credit"]> }) {
  return (
    <p className="label break-words text-foreground-muted">
      Foto: {credit.author} /{" "}
      <a href={credit.source} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-foreground">
        {credit.license}, Wikimedia Commons
      </a>
    </p>
  );
}
