/**
 * Host público do store do Vercel Blob da loja
 * (`<id>.public.blob.vercel-storage.com`). O `next.config.ts` libera no
 * otimizador de imagem só ele: um curinga (`*.public.blob.vercel-storage.com`)
 * aceitaria o store de QUALQUER conta da Vercel, e o site viraria proxy de
 * imagem alheia na nossa cota.
 *
 * O id sai de `BLOB_STORE_ID` (`store_<id>`, criado pela Vercel ao ligar o
 * store) ou, sem ele, do token de escrita (`vercel_blob_rw_<id>_<segredo>`,
 * o formato que o próprio `@vercel/blob` lê). Sem nenhum dos dois, `null`:
 * fora da Vercel as fotos ficam em disco e saem por `/api/midia`.
 *
 * Sem import nenhum de propósito: o `next.config.ts` carrega este arquivo.
 */
export function blobPublicHostname(env: Record<string, string | undefined>): string | null {
  const id = env.BLOB_STORE_ID?.trim().replace(/^store_/, "") || env.BLOB_READ_WRITE_TOKEN?.trim().split("_")[3];
  return id && /^[a-z0-9]+$/i.test(id) ? `${id.toLowerCase()}.public.blob.vercel-storage.com` : null;
}
