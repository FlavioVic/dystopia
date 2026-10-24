import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { SEED_PRODUCTS } from "@/db/seed-catalog";
import { PRODUCT_PHOTOS } from "@/lib/photo-credits";
import { PORTFOLIO } from "@/lib/portfolio";

const PUBLIC = path.resolve(import.meta.dirname, "../../public");
const file = (url: string) => path.join(PUBLIC, url);

describe("fotos de produto", () => {
  it("cada foto existe, é de um produto do catálogo e tem licença livre com crédito", () => {
    const slugs = new Set(SEED_PRODUCTS.map((p) => p.slug));
    for (const [slug, photo] of Object.entries(PRODUCT_PHOTOS)) {
      assert.ok(slugs.has(slug), `${slug} não está no catálogo`);
      assert.ok(existsSync(file(photo.file)), `${photo.file} não existe`);
      assert.match(photo.license, /^(CC0|CC BY(-SA)? \d\.\d|Public domain)/, `${slug}: licença ${photo.license}`);
      assert.ok(photo.author.length > 0 && photo.source.startsWith("https://commons.wikimedia.org/"), `${slug}: crédito incompleto`);
    }
  });
});

describe("portfólio", () => {
  it("cada projeto tem imagem, código único e repositório público", () => {
    const codes = new Set<string>();
    for (const p of PORTFOLIO) {
      assert.ok(existsSync(file(p.image)), `${p.image} não existe`);
      assert.ok(!codes.has(p.code), `código repetido: ${p.code}`);
      codes.add(p.code);
      assert.ok(p.repo.startsWith("https://github.com/FlavioVic/"), `${p.slug}: repo fora do perfil`);
    }
  });
});
