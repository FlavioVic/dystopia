import type { Metadata } from "next";
import Image from "next/image";
import { PageHeader, gridCell, gridFrame } from "@/components/Kit";
import { PRODUCT_PHOTOS } from "@/lib/photo-credits";
import { canonical } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Créditos",
  description: "Créditos das fotos de produto (Wikimedia Commons) e das fontes usadas na DYSTOPIA.",
  alternates: canonical("/creditos"),
};

const FONTS = [
  { name: "Michroma", by: "The Michroma Project Authors", license: "SIL OFL 1.1" },
  { name: "Inter Tight", by: "The Inter Project Authors", license: "SIL OFL 1.1" },
  { name: "IBM Plex Mono", by: "IBM Corp.", license: "SIL OFL 1.1" },
];

export default function CreditsPage() {
  return (
    <div className="mx-auto max-w-site px-4 py-12 sm:px-6 lg:px-8">
      <PageHeader
        label="Registro / Créditos"
        title="Créditos"
        description="As fotos de produto vêm da Wikimedia Commons, sob licenças livres, e só aparecem quando mostram o modelo exato vendido. Os demais itens usam placas técnicas desenhadas para a loja. Marcas pertencem aos fabricantes; preços são fictícios."
      />

      <h2 className="label mt-12 text-foreground-muted">Fotos de produto</h2>
      <ul className={`mt-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 ${gridFrame}`}>
        {Object.entries(PRODUCT_PHOTOS).map(([slug, photo]) => (
          <li key={slug} className={`flex flex-col gap-3 p-4 ${gridCell}`}>
            <div className="relative aspect-[4/3] bg-background-elevated">
              <Image src={photo.file} alt={photo.title} fill sizes="(min-width: 1024px) 22vw, 90vw" className="object-contain p-2" />
            </div>
            <p className="text-sm text-foreground">{photo.title.replace(/\.(jpe?g|png)$/i, "")}</p>
            <p className="label text-foreground-muted">
              {photo.author} /{" "}
              <a href={photo.licenseUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-foreground">
                {photo.license}
              </a>
            </p>
            <a href={photo.source} target="_blank" rel="noreferrer" className="label mt-auto text-signal-text hover:text-foreground">
              Arquivo original
            </a>
          </li>
        ))}
      </ul>

      <h2 className="label mt-12 text-foreground-muted">Fontes</h2>
      <ul className="mt-4 border-t border-border-faint">
        {FONTS.map((f) => (
          <li key={f.name} className="flex flex-wrap justify-between gap-2 border-b border-border-faint py-3 text-sm">
            <span>{f.name}</span>
            <span className="label text-foreground-muted">
              {f.by} / {f.license}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
