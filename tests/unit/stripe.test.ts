import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PermanentError, RetryableError, AppError } from "@/shared/errors";
import { charge, reverse, type GatewayDeps } from "@/services/payments/gateway";
import { stripeCharge, stripeConfigFromEnv, stripeRefund, type FetchLike } from "@/services/payments/stripe";

const config = { secretKey: "sk_test_123" };

type Call = { url: string; init: RequestInit; params: URLSearchParams };

/** `fetch` falso: grava as chamadas e devolve as respostas na ordem. */
function fakeFetch(...responses: Array<{ status: number; body: unknown } | Error>): FetchLike & { calls: Call[] } {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, params: new URLSearchParams(String(init.body)) });
    const next = responses.shift();
    if (!next) throw new Error("fetch chamado mais vezes que o esperado");
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as FetchLike & { calls: Call[] };
  impl.calls = calls;
  return impl;
}

function header(call: Call, name: string): string | undefined {
  return (call.init.headers as Record<string, string>)[name];
}

async function rejectsWith(
  promise: Promise<unknown>,
  expected: { type: typeof PermanentError | typeof RetryableError; code: string },
) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof expected.type, `esperava ${expected.type.name}, veio ${String(error)}`);
    assert.equal((error as AppError).code, expected.code);
    return true;
  });
}

describe("config do Stripe", () => {
  it("sem chave, Stripe desligado", () => {
    assert.equal(stripeConfigFromEnv({}), null);
  });

  it("aceita só chave de teste — chave de produção derruba", () => {
    assert.deepEqual(stripeConfigFromEnv({ STRIPE_SECRET_KEY: " sk_test_abc " }), { secretKey: "sk_test_abc" });
    assert.throws(() => stripeConfigFromEnv({ STRIPE_SECRET_KEY: "sk_live_abc" }), /modo de teste/);
  });
});

describe("cobrança no Stripe", () => {
  const input = { amountCents: 17_982, paymentMethodId: "pm_card_visa", idempotencyKey: "order:DYS-1:payment", orderId: "o1" };

  it("cria e confirma o PaymentIntent em BRL, com a chave de idempotência do pedido", async () => {
    const fetch = fakeFetch({ status: 200, body: { id: "pi_123", status: "succeeded" } });
    const result = await stripeCharge(config, input, fetch);

    assert.equal(result.transactionId, "pi_123");
    const [call] = fetch.calls;
    assert.equal(call.url, "https://api.stripe.com/v1/payment_intents");
    assert.equal(call.init.method, "POST");
    assert.equal(header(call, "Authorization"), "Bearer sk_test_123");
    assert.equal(header(call, "Idempotency-Key"), "order:DYS-1:payment");
    assert.equal(call.params.get("amount"), "17982", "centavos, sem conversão");
    assert.equal(call.params.get("currency"), "brl");
    assert.equal(call.params.get("payment_method"), "pm_card_visa");
    assert.equal(call.params.get("confirm"), "true");
    assert.equal(call.params.get("automatic_payment_methods[allow_redirects]"), "never");
    assert.equal(call.params.get("metadata[order_id]"), "o1");
  });

  it("cartão recusado é falha de negócio (compensa já), com mensagem para o comprador", async () => {
    const fetch = fakeFetch({
      status: 402,
      body: { error: { type: "card_error", code: "card_declined", decline_code: "insufficient_funds" } },
    });
    await assert.rejects(stripeCharge(config, input, fetch), (error: unknown) => {
      assert.ok(error instanceof PermanentError);
      assert.equal(error.code, "payment_declined");
      assert.equal(error.message, "Cartão sem saldo suficiente.");
      return true;
    });
  });

  it("3D Secure pendente não fica pendurado: é recusa explicada", async () => {
    const fetch = fakeFetch({ status: 200, body: { id: "pi_3ds", status: "requires_action" } });
    await rejectsWith(stripeCharge(config, input, fetch), { type: PermanentError, code: "authentication_required" });
  });

  it("Stripe fora, limite de requisições, erro de rede e falha do processador: tenta de novo", async () => {
    for (const response of [
      { status: 500, body: { error: { type: "api_error" } } },
      { status: 429, body: { error: { type: "rate_limit_error" } } },
      { status: 402, body: { error: { type: "card_error", code: "processing_error" } } },
      new TypeError("fetch failed"),
    ]) {
      await rejectsWith(stripeCharge(config, input, fakeFetch(response)), {
        type: RetryableError,
        code: "gateway_unavailable",
      });
    }
  });

  it("chave inválida não é retry: é configuração errada", async () => {
    const fetch = fakeFetch({ status: 401, body: { error: { type: "invalid_request_error" } } });
    await rejectsWith(stripeCharge(config, input, fetch), { type: PermanentError, code: "gateway_misconfigured" });
  });
});

describe("estorno no Stripe", () => {
  it("estorna o PaymentIntent com chave própria de idempotência", async () => {
    const fetch = fakeFetch({ status: 200, body: { id: "re_1", status: "succeeded" } });
    assert.deepEqual(await stripeRefund(config, { paymentIntentId: "pi_123", idempotencyKey: "k:refund" }, fetch), {
      reversed: true,
    });
    assert.equal(fetch.calls[0].url, "https://api.stripe.com/v1/refunds");
    assert.equal(fetch.calls[0].params.get("payment_intent"), "pi_123");
    assert.equal(header(fetch.calls[0], "Idempotency-Key"), "k:refund");
  });

  it("já estornado conta como sucesso (compensação idempotente)", async () => {
    const fetch = fakeFetch({ status: 400, body: { error: { type: "invalid_request_error", code: "charge_already_refunded" } } });
    assert.deepEqual(await stripeRefund(config, { paymentIntentId: "pi_123", idempotencyKey: "k" }, fetch), {
      reversed: true,
    });
  });
});

describe("roteamento do gateway", () => {
  const base = { amountCents: 5_000, method: "credit_card", idempotencyKey: "order:DYS-2:payment" };
  const withStripe = (fetch: FetchLike, allowTestTokens = true): GatewayDeps => ({ stripe: config, fetch, allowTestTokens });

  it("cartão tokenizado vai para o Stripe", async () => {
    const fetch = fakeFetch({ status: 200, body: { id: "pi_9", status: "succeeded" } });
    const result = await charge({ ...base, paymentToken: "pm_card_visa" }, withStripe(fetch));
    assert.deepEqual([result.provider, result.transactionId], ["stripe", "pi_9"]);
  });

  it("Pix/boleto (sem token) seguem no simulado, sem chamar o Stripe", async () => {
    const fetch = fakeFetch();
    const result = await charge({ ...base, method: "pix" }, withStripe(fetch));
    assert.equal(result.provider, "simulado");
    assert.equal(fetch.calls.length, 0);
  });

  it("cartão tokenizado sem Stripe configurado não é aprovado no simulado", async () => {
    await rejectsWith(charge({ ...base, paymentToken: "pm_card_visa" }, { stripe: null, fetch: fakeFetch() }), {
      type: PermanentError,
      code: "gateway_misconfigured",
    });
  });

  it("token de teste escolhe o caminho do provedor simulado, sem chamar o Stripe", async () => {
    const fetch = fakeFetch();
    await rejectsWith(charge({ ...base, paymentToken: "sim_unavailable" }, withStripe(fetch)), {
      type: RetryableError,
      code: "gateway_unavailable",
    });
    await rejectsWith(charge({ ...base, paymentToken: "sim_decline" }, withStripe(fetch)), {
      type: PermanentError,
      code: "payment_declined",
    });
    assert.equal(fetch.calls.length, 0, "o Stripe nem foi chamado");
  });

  it("token de teste sem o modo demonstração ligado é recusado (cobrança de verdade não escolhe resultado)", async () => {
    await rejectsWith(charge({ ...base, paymentToken: "sim_approve" }, withStripe(fakeFetch(), false)), {
      type: PermanentError,
      code: "test_token_rejected",
    });
  });

  it("token que não é de ninguém é recusado", async () => {
    await rejectsWith(charge({ ...base, paymentToken: "xyz_123456" }, withStripe(fakeFetch())), {
      type: PermanentError,
      code: "invalid_payment_token",
    });
  });

  it("estorno vai para o provedor que cobrou", async () => {
    const fetch = fakeFetch({ status: 200, body: { id: "re_2" } });
    await reverse({ transactionId: "pi_9", provider: "stripe", idempotencyKey: "order:DYS-2:payment" }, withStripe(fetch));
    assert.equal(fetch.calls.length, 1);
    assert.equal(header(fetch.calls[0], "Idempotency-Key"), "order:DYS-2:payment:refund");

    const untouched = fakeFetch();
    await reverse({ transactionId: "SIM-1", provider: "simulado", idempotencyKey: "x" }, withStripe(untouched));
    assert.equal(untouched.calls.length, 0);
  });
});
