import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { orderStatusEnum } from "@/db/schema";
import {
  ALLOWED_TRANSITIONS,
  canTransition,
  isOrderStatus,
  isTerminalStatus,
  nextStatuses,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  orderStatusClass,
} from "@/lib/order-status";

describe("status de pedido", () => {
  it("espelha exatamente o enum do banco", () => {
    assert.deepEqual([...ORDER_STATUSES], [...orderStatusEnum.enumValues]);
  });

  it("tem rótulo, cor e transições pra todo status", () => {
    for (const status of ORDER_STATUSES) {
      assert.ok(ORDER_STATUS_LABELS[status], `sem rótulo: ${status}`);
      assert.ok(orderStatusClass(status).length > 0);
      assert.ok(Array.isArray(ALLOWED_TRANSITIONS[status]), `sem transições: ${status}`);
    }
  });

  it("reconhece status válido", () => {
    assert.equal(isOrderStatus("paid"), true);
    assert.equal(isOrderStatus("pago"), false);
    assert.equal(isOrderStatus(undefined), false);
  });
});

describe("máquina de estados", () => {
  it("permite o caminho normal da loja", () => {
    assert.equal(canTransition("pending", "paid"), true);
    assert.equal(canTransition("paid", "processing"), true);
    assert.equal(canTransition("processing", "shipped"), true);
    assert.equal(canTransition("shipped", "delivered"), true);
    assert.equal(canTransition("delivered", "refunded"), true);
  });

  it("bloqueia volta no tempo e pulo indevido", () => {
    assert.equal(canTransition("delivered", "pending"), false);
    assert.equal(canTransition("shipped", "paid"), false);
    assert.equal(canTransition("pending", "shipped"), false);
    assert.equal(canTransition("pending", "delivered"), false);
  });

  it("permite cancelar só antes do envio", () => {
    assert.equal(canTransition("pending", "cancelled"), true);
    assert.equal(canTransition("paid", "cancelled"), true);
    assert.equal(canTransition("processing", "cancelled"), true);
    assert.equal(canTransition("shipped", "cancelled"), false);
    assert.equal(canTransition("delivered", "cancelled"), false);
  });

  it("trata cancelado e reembolsado como finais", () => {
    assert.equal(isTerminalStatus("cancelled"), true);
    assert.equal(isTerminalStatus("refunded"), true);
    assert.equal(isTerminalStatus("delivered"), false);
    assert.deepEqual(nextStatuses("cancelled"), []);
  });

  it("nenhum status permite transição pra si mesmo (quem trata isso é o serviço)", () => {
    for (const status of ORDER_STATUSES) {
      assert.equal(canTransition(status, status), false, `${status} → ${status}`);
    }
  });
});
