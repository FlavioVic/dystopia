/**
 * Validação do formulário de avaliação. Função pura (sem banco, sem Next) —
 * mesma razão de `validation/product.ts`: arquivo `"use server"` só exporta
 * async, então nada validado lá dentro seria testável.
 */

export const MIN_RATING = 1;
export const MAX_RATING = 5;
export const MAX_TITLE_LENGTH = 80;
export const MAX_COMMENT_LENGTH = 1_000;

export type ReviewFormValues = {
  rating: number;
  title: string | null;
  comment: string | null;
};

export type ReviewFormParse = {
  errors: Record<string, string>;
  values: ReviewFormValues;
};

export function parseReviewForm(formData: FormData): ReviewFormParse {
  const ratingRaw = String(formData.get("rating") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const comment = String(formData.get("comment") ?? "").trim();

  // Estrito de propósito: `parseInt("3.5x")` daria 3, e nota não é campo pra
  // adivinhar — o formulário manda um inteiro limpo ou é erro.
  const rating = /^\d+$/.test(ratingRaw) ? Number.parseInt(ratingRaw, 10) : Number.NaN;
  const errors: Record<string, string> = {};

  if (!Number.isInteger(rating) || rating < MIN_RATING || rating > MAX_RATING) {
    errors.rating = "Escolha de 1 a 5 estrelas.";
  }
  if (title.length > MAX_TITLE_LENGTH) {
    errors.title = `Máximo de ${MAX_TITLE_LENGTH} caracteres.`;
  }
  if (comment.length > MAX_COMMENT_LENGTH) {
    errors.comment = `Máximo de ${MAX_COMMENT_LENGTH} caracteres.`;
  }

  return {
    errors,
    values: {
      rating: Number.isInteger(rating) ? rating : 0,
      title: title || null,
      comment: comment || null,
    },
  };
}

/**
 * Média exibida no catálogo. `products.rating_average` é `decimal(2,1)`, então
 * a média vive com uma casa — arredondar aqui (e não no SQL) deixa a regra
 * testável e igual em qualquer lugar que recalcule.
 */
export function averageRating(ratings: number[]): string {
  if (ratings.length === 0) return "0";
  const sum = ratings.reduce((total, value) => total + value, 0);
  return (Math.round((sum / ratings.length) * 10) / 10).toFixed(1);
}
