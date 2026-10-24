import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { valuesOf } from "../helpers/form";
import {
  averageRating,
  MAX_COMMENT_LENGTH,
  MAX_TITLE_LENGTH,
  parseReviewForm,
} from "@/lib/validation/review";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("validação da avaliação", () => {
  it("aceita nota com título e comentário", () => {
    const values = valuesOf(parseReviewForm(
      form({ rating: "4", title: "  Muito bom  ", comment: "Chegou rápido." }),
    ));
    assert.equal(values.rating, 4);
    assert.equal(values.title, "Muito bom", "título vem sem espaço sobrando");
    assert.equal(values.comment, "Chegou rápido.");
  });

  it("aceita nota sem texto nenhum", () => {
    const values = valuesOf(parseReviewForm(form({ rating: "5" })));
    assert.equal(values.title, null);
    assert.equal(values.comment, null);
  });

  it("exige nota de 1 a 5", () => {
    for (const rating of ["0", "6", "-1", "", "abc", "3.5x"]) {
      assert.ok(parseReviewForm(form({ rating })).errors.rating, `deveria recusar: ${rating}`);
    }
    for (const rating of ["1", "2", "3", "4", "5"]) {
      assert.equal(parseReviewForm(form({ rating })).errors.rating, undefined);
    }
  });

  it("limita tamanho de título e comentário", () => {
    const longo = parseReviewForm(
      form({ rating: "5", title: "x".repeat(MAX_TITLE_LENGTH + 1), comment: "y".repeat(MAX_COMMENT_LENGTH + 1) }),
    );
    assert.match(longo.errors.title, /Máximo/);
    assert.match(longo.errors.comment, /Máximo/);

    const limite = parseReviewForm(
      form({ rating: "5", title: "x".repeat(MAX_TITLE_LENGTH), comment: "y".repeat(MAX_COMMENT_LENGTH) }),
    );
    assert.deepEqual(limite.errors, {}, "exatamente no limite é válido");
  });
});

describe("média de avaliações", () => {
  it("arredonda pra uma casa decimal", () => {
    assert.equal(averageRating([5, 4]), "4.5");
    assert.equal(averageRating([5, 4, 4]), "4.3");
    assert.equal(averageRating([1, 2]), "1.5");
    assert.equal(averageRating([4]), "4.0");
  });

  it("sem avaliação a média é zero", () => {
    assert.equal(averageRating([]), "0");
  });

  it("cabe em decimal(2,1) — nunca passa de 5.0", () => {
    const value = Number(averageRating([5, 5, 5]));
    assert.ok(value <= 5 && value >= 0);
  });
});
