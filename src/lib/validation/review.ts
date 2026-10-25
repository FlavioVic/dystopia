/**
 * Formulário de avaliação. Nota é estrita de propósito: `parseInt("3.5x")`
 * daria 3, e nota não é campo pra adivinhar.
 */

import { z } from "zod";
import { formStrings, optionalText, parseForm, wholeNumber } from "./form";

export const MIN_RATING = 1;
export const MAX_RATING = 5;
export const MAX_TITLE_LENGTH = 80;
export const MAX_COMMENT_LENGTH = 1_000;

const reviewSchema = z.object({
  rating: wholeNumber("Escolha de 1 a 5 estrelas.", MIN_RATING, MAX_RATING),
  title: optionalText({ length: MAX_TITLE_LENGTH, message: `Máximo de ${MAX_TITLE_LENGTH} caracteres.` }),
  comment: optionalText({ length: MAX_COMMENT_LENGTH, message: `Máximo de ${MAX_COMMENT_LENGTH} caracteres.` }),
});

export type ReviewFormValues = z.output<typeof reviewSchema>;

export function parseReviewForm(formData: FormData) {
  return parseForm(reviewSchema, formStrings(formData, ["rating", "title", "comment"]));
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
