import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { backoffMs, DEFAULT_BACKOFF, nextRunAt } from "@/queue/backoff";

/** `random: () => 0.5` zera o jitter — a curva fica determinística. */
const noJitter = { random: () => 0.5 };

describe("backoff da fila", () => {
  it("dobra o atraso a cada tentativa", () => {
    assert.equal(backoffMs(1, noJitter), 1_000);
    assert.equal(backoffMs(2, noJitter), 2_000);
    assert.equal(backoffMs(3, noJitter), 4_000);
    assert.equal(backoffMs(4, noJitter), 8_000);
  });

  it("respeita o teto", () => {
    assert.equal(backoffMs(20, noJitter), DEFAULT_BACKOFF.maxMs);
    assert.equal(backoffMs(5, { ...noJitter, baseMs: 1_000, maxMs: 5_000 }), 5_000);
  });

  it("trata a primeira tentativa (e valores degenerados) como atraso base", () => {
    assert.equal(backoffMs(0, noJitter), 1_000);
    assert.equal(backoffMs(-3, noJitter), 1_000);
  });

  it("aplica jitter dentro da faixa configurada", () => {
    const base = 4_000; // tentativa 3
    const min = backoffMs(3, { random: () => 0, jitter: 0.2 });
    const max = backoffMs(3, { random: () => 1, jitter: 0.2 });
    assert.equal(min, base * 0.8);
    assert.equal(max, base * 1.2);

    for (let i = 0; i < 200; i += 1) {
      const value = backoffMs(3);
      assert.ok(value >= min && value <= max, `fora da faixa: ${value}`);
    }
  });

  it("nunca devolve atraso negativo, mesmo com jitter maior que 1", () => {
    assert.equal(backoffMs(1, { random: () => 0, jitter: 3 }), 0);
  });

  it("nextRunAt soma o atraso ao instante informado", () => {
    const now = new Date("2026-10-21T12:00:00.000Z");
    const runAt = nextRunAt(2, now, noJitter);
    assert.equal(runAt.getTime() - now.getTime(), 2_000);
  });
});
