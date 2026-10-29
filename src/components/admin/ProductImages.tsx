"use client";

import Image from "next/image";
import { useActionState, useState, useTransition } from "react";
import { FormAlert, buttonCompact, buttonPrimary, fieldLabelClass, inputClass } from "@/components/Kit";
import {
  deleteProductImage,
  reorderProductImage,
  saveProductImageAlt,
  type ImageFormState,
} from "@/lib/actions/admin";

type GalleryImage = { id: string; url: string; altText: string | null };

/** Galeria do produto no painel: enviar, escolher a principal, ordenar, descrever e remover. */
export function ProductImages({
  images,
  uploadAction,
  storageReady,
  full,
}: {
  images: GalleryImage[];
  uploadAction: (prev: ImageFormState, formData: FormData) => Promise<ImageFormState>;
  storageReady: boolean;
  /** Chegou no limite de fotos: em vez do formulário, o aviso. */
  full: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {images.length === 0 ? (
        <p className="text-sm text-foreground-muted">Sem imagens — a loja mostra o produto sem foto.</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {images.map((image, index) => (
            <ImageRow key={image.id} image={image} index={index} last={index === images.length - 1} />
          ))}
        </ol>
      )}
      {full ? (
        <p className="text-sm text-foreground-muted">Limite de fotos atingido. Remova uma para enviar outra.</p>
      ) : storageReady ? (
        <UploadForm action={uploadAction} />
      ) : (
        <FormAlert>Armazenamento de imagens não configurado. Crie o Blob store na Vercel (docs/DEPLOY.md).</FormAlert>
      )}
    </div>
  );
}

function ImageRow({ image, index, last }: { image: GalleryImage; index: number; last: boolean }) {
  const [altState, altAction, savingAlt] = useActionState<ImageFormState, FormData>(
    saveProductImageAlt.bind(null, image.id),
    undefined,
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const run = (task: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const result = await task();
      setError(result.ok ? null : (result.error ?? "Não foi possível."));
    });

  return (
    <li className="flex flex-col gap-3 border border-border p-3 sm:flex-row sm:items-start">
      <div className="relative h-24 w-24 shrink-0 overflow-hidden border border-border-faint bg-background">
        <Image src={image.url} alt={image.altText ?? ""} fill sizes="96px" className="object-contain" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="label text-foreground-muted">
          {index === 0 ? <span className="text-foreground">Principal</span> : `Posição ${index + 1}`}
        </p>
        <form action={altAction} className="flex flex-wrap gap-2">
          <label htmlFor={`alt-${image.id}`} className="sr-only">
            Descrição da imagem {index + 1}
          </label>
          <input
            id={`alt-${image.id}`}
            name="altText"
            defaultValue={image.altText ?? ""}
            maxLength={160}
            placeholder="Descrição (texto alternativo)"
            className={`${inputClass} min-w-0 flex-1`}
          />
          <button type="submit" disabled={savingAlt} className={buttonCompact}>
            {savingAlt ? "Salvando…" : "Salvar descrição"}
          </button>
        </form>
        {altState?.message ? <FormAlert>{altState.message}</FormAlert> : null}
        {error ? <FormAlert>{error}</FormAlert> : null}
        <div className="flex flex-wrap gap-2">
          {index > 0 ? (
            <button type="button" disabled={pending} onClick={() => run(() => reorderProductImage(image.id, "first"))} className={buttonCompact}>
              Tornar principal
            </button>
          ) : null}
          <button
            type="button"
            disabled={pending || index === 0}
            onClick={() => run(() => reorderProductImage(image.id, "up"))}
            aria-label={`Mover imagem ${index + 1} para cima`}
            className={buttonCompact}
          >
            ↑
          </button>
          <button
            type="button"
            disabled={pending || last}
            onClick={() => run(() => reorderProductImage(image.id, "down"))}
            aria-label={`Mover imagem ${index + 1} para baixo`}
            className={buttonCompact}
          >
            ↓
          </button>
          {confirming ? (
            <>
              <button type="button" disabled={pending} onClick={() => run(() => deleteProductImage(image.id))} className={`${buttonCompact} border-signal`}>
                Confirmar remoção
              </button>
              <button type="button" onClick={() => setConfirming(false)} className={buttonCompact}>
                Cancelar
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className={buttonCompact}>
              Remover
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function UploadForm({ action }: { action: (prev: ImageFormState, formData: FormData) => Promise<ImageFormState> }) {
  const [state, formAction, pending] = useActionState<ImageFormState, FormData>(action, undefined);
  return (
    // `key` muda só a cada envio certo: o formulário volta vazio para a próxima foto.
    <form key={state?.sentAt ?? "upload"} action={formAction} className="flex flex-col gap-3 border border-dashed border-border p-3">
      <p className={fieldLabelClass}>Nova imagem</p>
      {state?.message ? <FormAlert>{state.message}</FormAlert> : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="image-file" className={fieldLabelClass}>
          Arquivo (JPEG, PNG, WebP ou AVIF, até 3 MB)
        </label>
        <input
          id="image-file"
          name="image"
          type="file"
          required
          accept="image/jpeg,image/png,image/webp,image/avif"
          className="text-sm text-foreground file:mr-3 file:border file:border-border file:bg-background file:px-3 file:py-2 file:text-foreground"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="image-alt" className={fieldLabelClass}>
          Descrição (texto alternativo)
        </label>
        <input id="image-alt" name="altText" maxLength={160} placeholder="Ex.: Cooler AK400 visto de frente" className={inputClass} />
      </div>
      <button type="submit" disabled={pending} className={`self-start ${buttonPrimary}`}>
        {pending ? "Enviando…" : "Enviar imagem"}
      </button>
    </form>
  );
}
