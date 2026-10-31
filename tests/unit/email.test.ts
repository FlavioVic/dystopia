import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PermanentError, RetryableError, type AppError } from "@/shared/errors";
import { renderHtml } from "@/services/notifications/delivery";
import { emailConfigFromEnv, resendSend, type FetchLike } from "@/services/notifications/resend";

const config = { apiKey: "re_123", from: "Dystopia <onboarding@resend.dev>", redirectTo: "dono@exemplo.dev" };
const email = { to: "dono@exemplo.dev", subject: "Oi", text: "texto", html: "<p>html</p>", idempotencyKey: "order-confirmation:DYS-1" };

function fakeFetch(response: { status: number; body: unknown } | Error) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return new Response(JSON.stringify(response.body), { status: response.status });
  };
  return Object.assign(impl, { calls });
}

describe("config de e-mail", () => {
  it("sem chave, entrega simulada", () => {
    assert.equal(emailConfigFromEnv({}), null);
  });

  it("com chave, exige o redirecionamento do sandbox (ou liberação explícita)", () => {
    assert.throws(() => emailConfigFromEnv({ RESEND_API_KEY: "re_1" }), /EMAIL_REDIRECT_TO/);
    assert.deepEqual(emailConfigFromEnv({ RESEND_API_KEY: "re_1", EMAIL_REDIRECT_TO: "eu@x.dev" }), {
      apiKey: "re_1",
      from: "Dystopia <onboarding@resend.dev>",
      redirectTo: "eu@x.dev",
    });
    assert.equal(
      emailConfigFromEnv({ RESEND_API_KEY: "re_1", EMAIL_DELIVER_TO_RECIPIENTS: "1" })?.redirectTo,
      null,
      "entregar ao comprador só por escolha explícita",
    );
    assert.throws(() => emailConfigFromEnv({ RESEND_API_KEY: "re_1", EMAIL_REDIRECT_TO: "não-é-email" }), /válido/);
  });
});

describe("envio pelo Resend", () => {
  it("manda JSON com a chave de idempotência da notificação", async () => {
    const fetch = fakeFetch({ status: 200, body: { id: "msg_1" } });
    assert.equal(await resendSend(config, email, fetch), "msg_1");

    const [call] = fetch.calls;
    assert.equal(call.url, "https://api.resend.com/emails");
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer re_123");
    assert.equal(headers["Idempotency-Key"], "order-confirmation:DYS-1");
    assert.deepEqual(JSON.parse(String(call.init.body)), {
      from: "Dystopia <onboarding@resend.dev>",
      to: ["dono@exemplo.dev"],
      subject: "Oi",
      text: "texto",
      html: "<p>html</p>",
    });
  });

  it("indisponível tenta de novo; recusa e chave inválida não", async () => {
    const cases: Array<[{ status: number; body: unknown } | Error, typeof PermanentError | typeof RetryableError, string]> = [
      [{ status: 500, body: {} }, RetryableError, "email_unavailable"],
      [{ status: 429, body: { name: "rate_limit_exceeded" } }, RetryableError, "email_unavailable"],
      [new TypeError("fetch failed"), RetryableError, "email_unavailable"],
      [{ status: 401, body: { name: "validation_error" } }, PermanentError, "email_misconfigured"],
      [{ status: 403, body: { name: "validation_error", message: "só para o seu e-mail" } }, PermanentError, "email_rejected"],
    ];
    for (const [response, type, code] of cases) {
      await assert.rejects(resendSend(config, email, fakeFetch(response)), (error: unknown) => {
        assert.ok(error instanceof type, `${code}: veio ${String(error)}`);
        assert.equal((error as AppError).code, code);
        return true;
      });
    }
  });
});

describe("HTML do e-mail", () => {
  it("escapa o conteúdo (nome do cliente vem do cadastro)", () => {
    const html = renderHtml("Pedido <1>", "Olá, <script>alert(1)</script> & cia");
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt; &amp; cia"));
    assert.ok(html.includes("Pedido &lt;1&gt;"));
  });
});
