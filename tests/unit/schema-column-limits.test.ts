/**
 * Guarda de regressão: as colunas de texto livre são `varchar(n)` no banco,
 * com o MESMO teto da validação Zod. É a defesa em profundidade da correção do
 * 500 do cadastro (um e-mail gigante estourava o índice único btree do
 * Postgres): se alguém mexer no cap da validação sem mexer na coluna (ou o
 * contrário), o limite deixa de bater e o bug pode voltar silencioso — aqui
 * quebra o CI antes disso.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addresses, coupons, products, reviews, serviceRequests, users } from "@/db/schema";
import { MAX_EMAIL_LENGTH, MAX_NAME_LENGTH, MAX_TEXT_LENGTH } from "@/lib/validation/form";
import { MAX_DESCRIPTION_LENGTH } from "@/lib/validation/product";
import { MAX_COMMENT_LENGTH, MAX_TITLE_LENGTH } from "@/lib/validation/review";
import { MAX_DETAILS_LENGTH } from "@/lib/validation/service-request";

/** Afirma que a coluna é varchar e devolve o teto declarado no banco. */
function varcharLen(col: { columnType: string; length?: number; name: string }): number {
  assert.equal(col.columnType, "PgVarchar", `coluna "${col.name}" deveria ser varchar, não ${col.columnType}`);
  assert.ok(typeof col.length === "number", `coluna "${col.name}" sem length`);
  return col.length;
}

describe("tetos de coluna (varchar) espelham a validação", () => {
  it("users: a chave que causava o 500 (e-mail) é varchar no teto da RFC", () => {
    // O índice único btree não aguenta valor > ~2704 bytes; varchar(254) nunca
    // chega perto, então o INSERT não estoura mais num endpoint público.
    assert.equal(varcharLen(users.email), MAX_EMAIL_LENGTH);
    assert.equal(varcharLen(users.name), MAX_NAME_LENGTH);
    assert.equal(varcharLen(users.phone), 20);
  });

  it("service_requests batem com o formulário público de orçamento", () => {
    assert.equal(varcharLen(serviceRequests.name), MAX_NAME_LENGTH);
    assert.equal(varcharLen(serviceRequests.email), MAX_EMAIL_LENGTH);
    assert.equal(varcharLen(serviceRequests.details), MAX_DETAILS_LENGTH);
  });

  it("catálogo: produto, cupom e avaliação", () => {
    assert.equal(varcharLen(products.name), MAX_TEXT_LENGTH);
    assert.equal(varcharLen(products.slug), 120);
    assert.equal(varcharLen(products.description), MAX_DESCRIPTION_LENGTH);
    assert.equal(varcharLen(reviews.title), MAX_TITLE_LENGTH);
    assert.equal(varcharLen(reviews.comment), MAX_COMMENT_LENGTH);
    assert.equal(varcharLen(coupons.code), 20); // CODE_PATTERN: 3-20 [A-Z0-9]
  });

  it("endereço: texto livre em MAX_TEXT_LENGTH, rótulo em 60, formato fixo no tamanho do formato", () => {
    assert.equal(varcharLen(addresses.street), MAX_TEXT_LENGTH);
    assert.equal(varcharLen(addresses.recipientName), MAX_TEXT_LENGTH);
    assert.equal(varcharLen(addresses.label), 60);
    assert.equal(varcharLen(addresses.state), 2); // UF
    assert.equal(varcharLen(addresses.zipCode), 9); // 00000-000
  });

  it("o que é hash/segredo continua text (não se limita o tamanho de um hash)", () => {
    assert.equal(users.passwordHash.columnType, "PgText");
  });
});
