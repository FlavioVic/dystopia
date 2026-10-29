"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { deleteOwnReview, submitReview, type ReviewState } from "@/lib/actions/reviews";
import { MAX_COMMENT_LENGTH, MAX_TITLE_LENGTH } from "@/lib/validation/review";

export type OwnReview = {
  rating: number;
  title: string | null;
  comment: string | null;
};

/**
 * Formulário de avaliação. Quem já avaliou vê a própria nota carregada —
 * enviar de novo edita (é o mesmo `upsert` do serviço), e dá para excluir.
 */
export function ReviewForm({
  productId,
  isLoggedIn,
  own,
}: {
  productId: string;
  isLoggedIn: boolean;
  own?: OwnReview | null;
}) {
  const [state, formAction, pending] = useActionState<ReviewState, FormData>(submitReview, undefined);
  const [rating, setRating] = useState(own?.rating ?? 0);
  // Prévia ao passar o mouse: mostra a nota que o clique vai dar.
  const [hovered, setHovered] = useState(0);
  const shown = hovered || rating;
  const [removing, startRemoving] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);

  if (!isLoggedIn) {
    return (
      <div className="rounded-xl border border-border bg-background-elevated p-4 text-sm">
        <p className="text-foreground-muted">
          <Link href="/entrar" className="font-semibold text-accent hover:underline">
            Entre na sua conta
          </Link>{" "}
          para avaliar este produto.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-xl border border-border bg-background-elevated p-4">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="rating" value={rating} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="label text-foreground-muted">
          {own ? "Sua avaliação" : "Avaliar este produto"}
        </span>
        <span className="flex items-center gap-3">
          {/* Vermelho (primary) só a partir de 24px, regra do design system: as estrelas têm 24px. */}
          <span className="flex items-center gap-0.5" onMouseLeave={() => setHovered(0)}>
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                aria-label={`${value} estrela${value > 1 ? "s" : ""}`}
                aria-pressed={rating === value}
                onClick={() => setRating(value)}
                onMouseEnter={() => setHovered(value)}
                onFocus={() => setHovered(value)}
                onBlur={() => setHovered(0)}
                className={`text-2xl leading-none transition-colors ${value <= shown ? "text-primary" : "text-border-hover"}`}
              >
                ★
              </button>
            ))}
          </span>
          <span className="label min-w-[5.5rem] text-foreground" aria-live="polite">
            {shown ? `${shown} de 5` : "Escolha a nota"}
          </span>
        </span>
      </div>

      {state?.errors?.rating ? (
        <span className="text-[11px] text-foreground">{state.errors.rating}</span>
      ) : null}

      <input
        name="title"
        defaultValue={own?.title ?? ""}
        maxLength={MAX_TITLE_LENGTH}
        placeholder="Título (opcional)"
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-foreground-muted focus:border-foreground"
      />
      {state?.errors?.title ? <span className="text-[11px] text-foreground">{state.errors.title}</span> : null}

      <textarea
        name="comment"
        defaultValue={own?.comment ?? ""}
        rows={3}
        maxLength={MAX_COMMENT_LENGTH}
        placeholder="Conta como foi a experiência com o produto (opcional)"
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-foreground-muted focus:border-foreground"
      />
      {state?.errors?.comment ? (
        <span className="text-[11px] text-foreground">{state.errors.comment}</span>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-primary px-4 py-2 label text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Enviando…" : own ? "Atualizar avaliação" : "Publicar avaliação"}
        </button>

        {own ? (
          <button
            type="button"
            disabled={removing}
            onClick={() =>
              startRemoving(async () => {
                const result = await deleteOwnReview(productId);
                setRemoveError(result.ok ? null : result.error ?? "Erro.");
              })
            }
            className="text-xs font-medium text-foreground-muted hover:text-foreground disabled:opacity-50"
          >
            {removing ? "Excluindo…" : "Excluir"}
          </button>
        ) : null}

        {state?.ok ? <span className="text-xs text-foreground">{state.message}</span> : null}
        {state?.message && !state.ok ? (
          <span className="text-xs text-foreground">{state.message}</span>
        ) : null}
        {removeError ? <span className="text-xs text-foreground">{removeError}</span> : null}
      </div>
    </form>
  );
}
