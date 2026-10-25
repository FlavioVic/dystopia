/**
 * Código que o Next põe no erro de Server Component em produção (a mensagem
 * original não vai para o navegador). Lido de qualquer objeto: o erro nem sempre
 * chega como instância de `Error` no boundary.
 */
export function errorDigest(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("digest" in error)) return null;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.length > 0 ? digest : null;
}
