/**
 * Envio de foto pelo painel: o formato vem dos bytes (nome e tipo mentem), SVG
 * e HTML não entram, a chave do arquivo não sai da pasta, e o armazenamento
 * certo é escolhido pelo ambiente.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { LOCAL_MEDIA_PREFIX, mediaStorageFromEnv, safeMediaKey } from "@/lib/media-storage";
import { MAX_IMAGE_BYTES, checkImageUpload, detectImageType } from "@/lib/product-media";

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(values.flatMap((v) => (typeof v === "string" ? [...v].map((c) => c.charCodeAt(0)) : [v])));

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d);
const WEBP = bytes("RIFF", 0x24, 0, 0, 0, "WEBPVP8 ");
const AVIF = bytes(0, 0, 0, 0x1c, "ftypavif", 0, 0, 0, 0);

describe("formato da foto enviada", () => {
  it("reconhece JPEG, PNG, WebP e AVIF pelos primeiros bytes", () => {
    assert.equal(detectImageType(JPEG), "jpeg");
    assert.equal(detectImageType(PNG), "png");
    assert.equal(detectImageType(WEBP), "webp");
    assert.equal(detectImageType(AVIF), "avif");
  });

  it("recusa SVG, HTML, GIF e arquivo vazio, mesmo com nome de imagem", () => {
    for (const fake of [
      bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      bytes("<!doctype html><script>alert(1)</script>"),
      bytes("GIF89a", 1, 0, 1, 0),
      bytes("RIFF", 0, 0, 0, 0, "WAVEfmt "),
      new Uint8Array(),
    ]) {
      assert.equal(detectImageType(fake), null);
    }
  });

  it("limite de 3 MB e mensagem que diz o que fazer", () => {
    assert.deepEqual(checkImageUpload({ size: JPEG.length, bytes: JPEG }), { ok: true, type: "jpeg" });
    assert.match((checkImageUpload({ size: MAX_IMAGE_BYTES + 1, bytes: JPEG }) as { error: string }).error, /3 MB/);
    assert.match((checkImageUpload({ size: 0, bytes: new Uint8Array() }) as { error: string }).error, /Escolha/);
    assert.match((checkImageUpload({ size: 10, bytes: bytes("<svg/>") }) as { error: string }).error, /JPEG, PNG, WebP ou AVIF/);
  });
});

describe("chave do arquivo", () => {
  it("aceita só segmentos simples com extensão de imagem", () => {
    assert.equal(safeMediaKey("produtos/0b1c-2d/a1b2.webp"), "produtos/0b1c-2d/a1b2.webp");
    for (const bad of ["../segredo.png", "produtos/../../etc/passwd.png", "/abs.png", "produtos/x.svg", "produtos/x.html", "produtos/X.PNG", "produtos//x.png", ""]) {
      assert.equal(safeMediaKey(bad), null, bad);
    }
  });
});

describe("armazenamento escolhido pelo ambiente", () => {
  const dirs: string[] = [];
  after(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });

  it("com token do Blob, usa o Blob; na Vercel sem token, nenhum; fora dela, pasta local", () => {
    assert.equal(mediaStorageFromEnv({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x" })?.kind, "blob");
    assert.equal(mediaStorageFromEnv({ VERCEL: "1" }), null);
    assert.equal(mediaStorageFromEnv({ UPLOADS_DIR: "/tmp/x" })?.kind, "disk");
  });

  it("o Blob só apaga o que é dele (foto do catálogo no repositório fica)", () => {
    const blob = mediaStorageFromEnv({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x" })!;
    assert.equal(blob.owns("https://abc123.public.blob.vercel-storage.com/produtos/x.webp"), true);
    assert.equal(blob.owns("/images/photos/deepcool-ak400.webp"), false);
    assert.equal(blob.owns("https://evil.example/produtos/x.webp"), false);
  });

  it("pasta local: grava, devolve a URL servida por /api/midia e apaga", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "dystopia-midia-"));
    dirs.push(dir);
    const disk = mediaStorageFromEnv({ UPLOADS_DIR: dir })!;

    const url = await disk.put("produtos/p1/foto.png", Buffer.from(PNG), "image/png");
    assert.equal(url, `${LOCAL_MEDIA_PREFIX}produtos/p1/foto.png`);
    assert.deepEqual(new Uint8Array(await readFile(path.join(dir, "produtos/p1/foto.png"))), PNG);

    await disk.remove("/images/photos/deepcool-ak400.webp"); // não é dela: nada acontece
    await disk.remove(url);
    assert.equal(existsSync(path.join(dir, "produtos/p1/foto.png")), false);
    await assert.rejects(disk.put("../fora.png", Buffer.from(PNG), "image/png"), /chave de mídia inválida/);
  });
});
