import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeAlerts, formatDuration } from "@/lib/observability";

const healthyQueue = { dead: 0, ready: 0, oldestReadyAgeMs: 0 };
const healthySagas = { stuck: 0, failed: 0 };

describe("alertas da operação", () => {
  it("sistema saudável não alerta", () => {
    assert.deepEqual(computeAlerts(healthyQueue, healthySagas), []);
  });

  it("dead-letter e compensação falha são críticos", () => {
    const alerts = computeAlerts({ ...healthyQueue, dead: 2 }, { ...healthySagas, failed: 1 });
    assert.deepEqual(
      alerts.map((a) => [a.id, a.level]),
      [
        ["compensation-failed", "critical"],
        ["dead-letter", "critical"],
      ],
    );
    assert.match(alerts[1].title, /2 jobs/);
    assert.match(alerts[0].title, /1 saga com/);
  });

  it("fila só é atrasada se o job pronto mais velho passou do limite", () => {
    const within = computeAlerts({ dead: 0, ready: 3, oldestReadyAgeMs: 1_500 }, healthySagas);
    assert.deepEqual(within, [], "polling normal do worker não é atraso");

    const late = computeAlerts({ dead: 0, ready: 3, oldestReadyAgeMs: 90_000 }, healthySagas);
    assert.deepEqual(late.map((a) => a.id), ["queue-lag"]);
    assert.match(late[0].title, /1 min/);
  });

  it("o limite de atraso é configurável", () => {
    const alerts = computeAlerts({ dead: 0, ready: 1, oldestReadyAgeMs: 5_000 }, healthySagas, { queueLagMs: 2_000 });
    assert.deepEqual(alerts.map((a) => a.id), ["queue-lag"]);
  });

  it("saga parada é aviso, não crítico (a reconciliação ainda pode resolver)", () => {
    const [alert] = computeAlerts(healthyQueue, { ...healthySagas, stuck: 3 });
    assert.equal(alert.id, "stuck-sagas");
    assert.equal(alert.level, "warning");
    assert.match(alert.title, /3 sagas paradas/);
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
