import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkoutSaga, parseCheckoutPayload, paymentIdempotencyKey } from "@/saga/definitions/checkout";
import { PermanentError } from "@/shared/errors";

const valid = {
  orderId: "11111111-1111-1111-1111-111111111111",
  orderNumber: "DYS-2026-123456",
  userId: "22222222-2222-2222-2222-222222222222",
  customerName: "Cliente Teste",
  customerEmail: "cliente@teste.dev",
  cartId: "33333333-3333-3333-3333-333333333333",
  paymentMethod: "pix",
  totalCents: 19_980,
  couponId: null,
  lines: [
    {
      productId: "44444444-4444-4444-4444-444444444444",
      variantId: null,
      name: "Caneca",
      quantity: 2,
      unitPriceCents: 9_990,
    },
  ],
};

describe("payload da saga de checkout", () => {
  it("aceita um payload completo", () => {
    const payload = parseCheckoutPayload(valid);
    assert.equal(payload.orderNumber, "DYS-2026-123456");
    assert.equal(payload.lines.length, 1);
    assert.equal(payload.simulate, undefined);
  });

  it("mantém o modo de simulação só quando ele é válido", () => {
    assert.equal(parseCheckoutPayload({ ...valid, simulate: "decline" }).simulate, "decline");
    assert.equal(parseCheckoutPayload({ ...valid, simulate: "qualquer-coisa" }).simulate, undefined);
  });

  it("rejeita payload que não é objeto", () => {
    for (const raw of [null, undefined, 42, "texto", []]) {
      assert.throws(() => parseCheckoutPayload(raw), PermanentError);
    }
  });

  it("rejeita campos obrigatórios ausentes", () => {
    assert.throws(() => parseCheckoutPayload({ ...valid, orderId: "" }), /orderId/);
    assert.throws(() => parseCheckoutPayload({ ...valid, totalCents: "19980" }), /totalCents/);
    assert.throws(() => parseCheckoutPayload({ ...valid, paymentMethod: "cripto" }), /pagamento/);
  });

  it("rejeita pedido sem itens ou com quantidade inválida", () => {
    assert.throws(() => parseCheckoutPayload({ ...valid, lines: [] }), /sem itens/);
    assert.throws(
      () => parseCheckoutPayload({ ...valid, lines: [{ ...valid.lines[0], quantity: 0 }] }),
      /quantidade/,
    );
  });

  it("erro de payload é permanente (não faz sentido tentar de novo)", () => {
    try {
      parseCheckoutPayload({});
      assert.fail("deveria lançar");
    } catch (error) {
      assert.ok(error instanceof PermanentError);
      assert.equal(error.retryable, false);
      assert.equal(error.code, "invalid_payload");
    }
  });

  it("chave de idempotência do pagamento é estável por pedido", () => {
    assert.equal(paymentIdempotencyKey("DYS-2026-1"), paymentIdempotencyKey("DYS-2026-1"));
    assert.notEqual(paymentIdempotencyKey("DYS-2026-1"), paymentIdempotencyKey("DYS-2026-2"));
  });
});

describe("motivo do cancelamento para o cliente", () => {
  it("traduz o código sem vazar detalhe técnico", () => {
    const describe = checkoutSaga.describeFailure!;
    assert.match(describe("out_of_stock"), /estoque/i);
    assert.match(describe("payment_declined"), /recusado/i);
    assert.match(describe("coupon_exhausted"), /cupom/i);
    assert.match(describe("deadlock_detected_42P01"), /Não foi possível concluir/i);
  });
});
