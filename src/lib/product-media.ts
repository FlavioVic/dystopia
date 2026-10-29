/**
 * Validação da foto enviada pelo painel. Quem decide o formato são os
 * primeiros bytes do arquivo, não o nome nem o `type` que o navegador manda
 * (os dois são escolhidos por quem envia). SVG fica de fora de propósito: é
 * texto que pode carregar script.
 */

/** Cabe no limite da Server Action (3,5 MB, ver next.config.ts) com folga para o multipart. */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

export type ImageType = "jpeg" | "png" | "webp" | "avif";

export const IMAGE_CONTENT_TYPES: Record<ImageType, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));

/** Formato pela assinatura do arquivo, ou `null` se não for uma das fotos aceitas. */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  // ISO BMFF: "ftyp" no byte 4 e a marca principal logo depois.
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(bytes, 8, 12))) return "avif";
  return null;
}

export type ImageCheck = { ok: true; type: ImageType } | { ok: false; error: string };

export function checkImageUpload(file: { size: number; bytes: Uint8Array }): ImageCheck {
  if (file.size === 0) return { ok: false, error: "Escolha uma imagem." };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "A imagem passa de 3 MB. Reduza antes de enviar." };
  const type = detectImageType(file.bytes);
  if (!type) return { ok: false, error: "Formato não aceito. Envie JPEG, PNG, WebP ou AVIF." };
  return { ok: true, type };
}

/**
 * Placa técnica gerada (`npm run art`, SVG) preenche o quadro; foto real
 * (do catálogo ou enviada pelo painel) aparece inteira, sem corte — cortar
 * uma placa de vídeo no meio não mostra o produto.
 */
export function isTechnicalPlate(url: string): boolean {
  return url.endsWith(".svg");
}
