import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
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

/** Toda imagem e vídeo servidos de `public/` (e os prints do README), recursivo. */
function mediaFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return mediaFiles(full);
    return /\.(png|jpe?g|gif|bmp|tiff?|webp|avif|mp4|mov|avi|mkv|webm)$/i.test(entry.name) ? [full] : [];
  });
}

describe("peso da mídia", () => {
  // E-mail é a exceção: Outlook e Gmail antigo não mostram webp.
  const EMAIL_ONLY = path.join(PUBLIC, "email");
  const files = [...mediaFiles(PUBLIC), ...mediaFiles(path.resolve(PUBLIC, "../docs/screenshots"))];

  it("imagem é webp e tem menos de 300 KB; vídeo é webm", () => {
    assert.ok(files.length > 0);
    for (const full of files) {
      const name = path.relative(PUBLIC, full);
      if (/\.(mp4|mov|avi|mkv|webm)$/i.test(full)) {
        assert.match(full, /\.webm$/, `${name}: vídeo tem que ser webm`);
        continue;
      }
      if (!full.startsWith(EMAIL_ONLY)) assert.match(full, /\.webp$/, `${name}: imagem tem que ser webp`);
      assert.ok(statSync(full).size < 300 * 1024, `${name}: ${Math.round(statSync(full).size / 1024)} KB (máx. 300)`);
    }
  });
});
