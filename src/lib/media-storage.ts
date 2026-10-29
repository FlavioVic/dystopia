/**
 * Onde moram as fotos enviadas pelo painel. Duas implementações da mesma
 * interface, como pagamento (Stripe x simulado):
 *
 * - Vercel Blob, com `BLOB_READ_WRITE_TOKEN` (produção): a Vercel não deixa a
 *   função gravar arquivo, e o Blob serve a foto pela CDN dela;
 * - pasta local (`UPLOADS_DIR`, padrão `.uploads/`) fora da Vercel: dev,
 *   testes e a stack do compose, servida por `/api/midia/...`.
 *
 * Na Vercel sem token não há onde guardar: o painel avisa em vez de quebrar.
 * A chave do arquivo é gerada aqui (nunca o nome que veio do navegador).
 */

import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { del, put } from "@vercel/blob";

export type MediaStorage = {
  kind: "blob" | "disk";
  /** Grava e devolve a URL pública. */
  put(key: string, bytes: Buffer, contentType: string): Promise<string>;
  /** Apaga se a URL for deste armazenamento; foto do catálogo (`/images/...`) fica. */
  remove(url: string): Promise<void>;
  owns(url: string): boolean;
};

export const LOCAL_MEDIA_PREFIX = "/api/midia/";
const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

export function localMediaDir(): string {
  return process.env.UPLOADS_DIR ?? path.join(process.cwd(), ".uploads");
}

/** Chave aceita: segmentos de [a-z0-9_-] com extensão, sem `..` nem barra inicial. */
export function safeMediaKey(key: string): string | null {
  return /^(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:jpe?g|png|webp|avif)$/.test(key) ? key : null;
}

function blobStorage(token: string): MediaStorage {
  const owns = (url: string) => {
    try {
      return new URL(url).hostname.endsWith(BLOB_HOST_SUFFIX);
    } catch {
      return false;
    }
  };
  return {
    kind: "blob",
    async put(key, bytes, contentType) {
      const blob = await put(key, bytes, { access: "public", contentType, token, addRandomSuffix: false });
      return blob.url;
    },
    async remove(url) {
      if (owns(url)) await del(url, { token });
    },
    owns,
  };
}

function diskStorage(dir: string): MediaStorage {
  const owns = (url: string) => url.startsWith(LOCAL_MEDIA_PREFIX);
  const fileFor = (key: string) => {
    if (!safeMediaKey(key)) throw new Error(`chave de mídia inválida: ${key}`);
    return path.join(dir, key);
  };
  return {
    kind: "disk",
    async put(key, bytes) {
      const file = fileFor(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes);
      return LOCAL_MEDIA_PREFIX + key;
    },
    async remove(url) {
      if (!owns(url)) return;
      await unlink(fileFor(url.slice(LOCAL_MEDIA_PREFIX.length))).catch(() => undefined);
    },
    owns,
  };
}

/** Blob com token; fora da Vercel, pasta local; na Vercel sem token, nenhum. */
export function mediaStorageFromEnv(env: Record<string, string | undefined> = process.env): MediaStorage | null {
  if (env.BLOB_READ_WRITE_TOKEN) return blobStorage(env.BLOB_READ_WRITE_TOKEN);
  if (env.VERCEL === "1") return null;
  return diskStorage(env.UPLOADS_DIR ?? path.join(process.cwd(), ".uploads"));
}
