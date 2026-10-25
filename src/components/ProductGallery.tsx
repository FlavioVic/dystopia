"use client";

import { useState } from "react";
import Image from "next/image";

export function ProductGallery({
  images,
  productName,
}: {
  images: { url: string; altText: string | null; credit?: { author: string; license: string; source: string } }[];
  productName: string;
}) {
  const [active, setActive] = useState(0);
  const current = images[active] ?? images[0];

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square overflow-hidden border border-border-faint bg-background">
        {current ? (
          <Image
            src={current.url}
            alt={current.altText ?? productName}
            fill
            priority
            sizes="(min-width: 1024px) 40vw, 90vw"
            className={current.credit ? "object-contain p-4" : "object-cover"}
          />
        ) : null}
      </div>
      {current?.credit ? (
        <p className="label break-words text-foreground-muted">
          Foto: {current.credit.author} /{" "}
          <a href={current.credit.source} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-foreground">
            {current.credit.license}, Wikimedia Commons
          </a>
        </p>
      ) : null}

      {images.length > 1 ? (
        <div className="flex gap-2">
          {images.map((img, i) => (
            <button
              key={img.url + i}
              type="button"
              onClick={() => setActive(i)}
              className={`relative h-16 w-16 shrink-0 overflow-hidden border ${
                i === active ? "border-foreground" : "border-border-faint hover:border-border"
              }`}
              aria-label={`Ver imagem ${i + 1}`}
            >
              <Image src={img.url} alt="" fill sizes="64px" className="object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
