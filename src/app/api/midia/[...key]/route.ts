import { readFile } from "node:fs/promises";
import path from "node:path";
import { localMediaDir, mediaStorageFromEnv, safeMediaKey } from "@/lib/media-storage";

/**
 * Serve as fotos do armazenamento LOCAL (dev, testes, stack do compose). Em
 * produção as fotos vêm do Vercel Blob e esta rota responde 404. A chave passa
 * pela mesma validação da gravação: nada de `..` para sair da pasta.
 */

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

export async function GET(_request: Request, ctx: RouteContext<"/api/midia/[...key]">): Promise<Response> {
  if (mediaStorageFromEnv()?.kind !== "disk") return new Response(null, { status: 404 });
  const key = safeMediaKey((await ctx.params).key.join("/"));
  if (!key) return new Response(null, { status: 404 });

  try {
    const bytes = await readFile(path.join(localMediaDir(), key));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": CONTENT_TYPES[key.split(".").pop()!] ?? "application/octet-stream",
        // A chave é única por envio (uuid): o arquivo nunca muda.
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
