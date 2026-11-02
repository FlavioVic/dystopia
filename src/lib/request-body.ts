/**
 * Corpo JSON de rota com teto de tamanho. `request.json()` lê tudo para a
 * memória antes de qualquer checagem: um POST de 200 MB levou o app de 65 MB
 * para 675 MB de memória no teste de carga — e a tarefa web na AWS tem 1 GB.
 * Na Vercel a borda corta em 4,5 MB, mas no docker-compose e na AWS nada
 * corta antes do app.
 *
 * Recusa pelo `Content-Length` declarado sem ler nada e, se ele mentir ou
 * não vier (envio em pedaços), para de ler ao passar do teto.
 */

export type JsonBody = { ok: true; value: unknown } | { ok: false; status: 400 | 413 };

export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBody> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > maxBytes) return { ok: false, status: 413 };
  if (!request.body) return { ok: false, status: 400 };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return { ok: false, status: 413 };
    }
    chunks.push(value);
  }

  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, status: 400 };
  }
}
