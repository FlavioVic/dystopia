import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readJsonBody } from "@/lib/request-body";

const LIMIT = 1_000;

/** Corpo enviado em pedaços, sem `Content-Length` — o caso de quem mente ou omite o tamanho. */
function chunked(parts: string[]): Request {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  return new Request("http://loja.dev/api", { method: "POST", body: stream, duplex: "half" } as RequestInit);
}

describe("corpo JSON com teto", () => {
  it("lê o JSON dentro do limite", async () => {
    const request = new Request("http://loja.dev/api", { method: "POST", body: '{"messages":[]}' });
    assert.deepEqual(await readJsonBody(request, LIMIT), { ok: true, value: { messages: [] } });
  });

  it("Content-Length acima do teto: recusa sem ler o corpo", async () => {
    const request = new Request("http://loja.dev/api", {
      method: "POST",
      headers: { "content-length": String(LIMIT + 1) },
      body: chunked(["{}"]).body,
      duplex: "half",
    } as RequestInit);
    assert.deepEqual(await readJsonBody(request, LIMIT), { ok: false, status: 413 });
    assert.equal(request.bodyUsed, false, "o corpo nem começou a ser lido");
  });

  it("sem Content-Length, para de ler ao passar do teto", async () => {
    const parts = ['{"a":"', "x".repeat(600), "x".repeat(600), '"}'];
    assert.deepEqual(await readJsonBody(chunked(parts), LIMIT), { ok: false, status: 413 });
  });

  it("JSON quebrado ou corpo vazio é pedido inválido", async () => {
    assert.deepEqual(await readJsonBody(chunked(["{messages:"]), LIMIT), { ok: false, status: 400 });
    assert.deepEqual(await readJsonBody(new Request("http://loja.dev/api", { method: "POST" }), LIMIT), {
      ok: false,
      status: 400,
    });
  });
});
