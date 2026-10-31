import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeAlerts, formatDuration } from "@/lib/observability";

const healthyQueue = {
  dead: 0,
  broker: { status: "up" as const },
  outbox: { pending: 0, oldestPendingAgeMs: 0, failing: 0 },
};
const healthySagas = { stuck: 0, failed: 0, halted: 0 };

describe("alertas da operação", () => {
  it("sistema saudável não alerta", () => {
    assert.deepEqual(computeAlerts(healthyQueue, healthySagas), []);
  });

  it("DLQ e compensação falha são críticos", () => {
    const alerts = computeAlerts({ ...healthyQueue, dead: 2 }, { ...healthySagas, failed: 1 });
    assert.deepEqual(
      alerts.map((a) => [a.id, a.level]),
      [
        ["compensation-failed", "critical"],
        ["dead-letter", "critical"],
      ],
    );
    assert.match(alerts[1].title, /2 mensagens na DLQ/);
    assert.match(alerts[0].title, /1 saga com/);
  });

  it("broker fora é crítico (e diz que nada se perdeu)", () => {
    const [alert] = computeAlerts({ ...healthyQueue, broker: { status: "down", error: "ECONNREFUSED" } }, healthySagas);
    assert.equal(alert.id, "broker-down");
    assert.equal(alert.level, "critical");
    assert.match(alert.detail, /outbox/);
  });

  it("outbox só é atrasada se a mensagem mais velha passou do limite", () => {
    const outbox = (oldestPendingAgeMs: number) => ({ pending: 3, oldestPendingAgeMs, failing: 0 });
    assert.deepEqual(computeAlerts({ ...healthyQueue, outbox: outbox(400) }, healthySagas), [], "ciclo normal do relay");

    const late = computeAlerts({ ...healthyQueue, outbox: outbox(90_000) }, healthySagas);
    assert.deepEqual(late.map((a) => a.id), ["outbox-lag"]);
    assert.match(late[0].title, /1 min/);
  });

  it("o limite de atraso é configurável", () => {
    const outbox = { pending: 1, oldestPendingAgeMs: 5_000, failing: 0 };
    const alerts = computeAlerts({ ...healthyQueue, outbox }, healthySagas, { outboxLagMs: 2_000 });
    assert.deepEqual(alerts.map((a) => a.id), ["outbox-lag"]);
  });

  it("saga sem progresso é aviso, não crítico (a reconciliação ainda pode resolver)", () => {
    const [alert] = computeAlerts(healthyQueue, { ...healthySagas, stuck: 3 });
    assert.equal(alert.id, "stuck-sagas");
    assert.equal(alert.level, "warning");
    assert.match(alert.title, /3 sagas sem progresso/);
  });

  it("saga parada depois do pagamento é crítica e diz que nada foi estornado", () => {
    const [alert] = computeAlerts(healthyQueue, { ...healthySagas, halted: 1 });
    assert.equal(alert.id, "halted-sagas");
    assert.equal(alert.level, "critical");
    assert.match(alert.title, /1 saga parada depois do pagamento/);
    assert.match(alert.detail, /Nada é estornado/);
  });
});

describe("formatDuration", () => {
  it("escolhe a unidade pelo tamanho", () => {
    assert.equal(formatDuration(null), "—");
    assert.equal(formatDuration(240), "240 ms");
    assert.equal(formatDuration(3_600), "3,6 s");
    assert.equal(formatDuration(125_000), "2 min");
    assert.equal(formatDuration(7_300_000), "2 h");
  });
});
