/**
 * Busca full-text contra o Postgres real: acento, prefixo, várias palavras,
 * relevância e entrada hostil.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { db } from "@/db";
import { categories, products } from "@/db/schema";
import { searchProducts } from "@/lib/data/products";
import { parsePage } from "@/lib/pagination";
import { closeDatabase, resetDatabase } from "../helpers/db";

before(async () => {
  await resetDatabase();
  const [category] = await db.insert(categories).values({ name: "Peças", slug: "pecas" }).returning();
  const base = { categoryId: category.id, priceCents: 1_000, stockQuantity: 5 };
  await db.insert(products).values([
    { ...base, name: "Memória Fury Beast DDR5", slug: "fury", sku: "MEM-1", brand: "Kingston", description: "Módulo de memória." },
    { ...base, name: "Processador Ryzen 5 9600X", slug: "ryzen", sku: "CPU-1", brand: "AMD", description: "Seis núcleos." },
    { ...base, name: "Placa de vídeo RTX 5060", slug: "rtx", sku: "GPU-1", brand: "NVIDIA", description: "Ótima com processador Ryzen." },
    { ...base, name: "Gabinete inativo Ryzen", slug: "inativo", sku: "GAB-1", description: "x", isActive: false },
  ]);
});
after(closeDatabase);

const names = async (query: string) => (await searchProducts(query, parsePage("1", 50))).items.map((p) => p.name);

describe("busca de produtos", () => {
  it("sem acento acha com acento", async () => {
    assert.deepEqual(await names("memoria"), ["Memória Fury Beast DDR5"]);
  });

  it("prefixo acha a palavra inteira", async () => {
    assert.ok((await names("ryz")).includes("Processador Ryzen 5 9600X"));
  });

  it("todas as palavras precisam bater", async () => {
    assert.deepEqual(await names("rtx 5060"), ["Placa de vídeo RTX 5060"]);
    assert.deepEqual(await names("rtx 9600x"), []);
  });

  it("nome pesa mais que descrição", async () => {
    const found = await names("ryzen");
    assert.deepEqual(found, ["Processador Ryzen 5 9600X", "Placa de vídeo RTX 5060"], "o que só cita na descrição vem depois");
  });

  it("marca e SKU também são buscáveis; produto inativo não aparece", async () => {
    assert.deepEqual(await names("kingston"), ["Memória Fury Beast DDR5"]);
    assert.deepEqual(await names("gpu-1"), ["Placa de vídeo RTX 5060"]);
    assert.ok(!(await names("gabinete")).includes("Gabinete inativo Ryzen"));
  });

  it("pagina o resultado e conta o total de verdade", async () => {
    const first = await searchProducts("ryzen", parsePage("1", 1));
    const second = await searchProducts("ryzen", parsePage("2", 1));
    assert.equal(first.total, 2);
    assert.equal(second.total, 2);
    assert.deepEqual([first.items[0].name, second.items[0].name], ["Processador Ryzen 5 9600X", "Placa de vídeo RTX 5060"]);
  });

  it("entrada hostil não quebra a consulta", async () => {
    assert.deepEqual(await names("'); drop table products; --"), []);
    assert.deepEqual(await names("%"), []);
    assert.deepEqual(await names("& | ! ( ) :*"), []);
  });
});
