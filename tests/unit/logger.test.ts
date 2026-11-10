/** Log não leva segredo, nem quando alguém passa o campo por engano. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLogger } from "@/lib/logger";

describe("log", () => {
  it("campo com nome de segredo sai como [omitido]; o resto fica", (t) => {
    const lines: string[] = [];
    t.mock.method(console, "info", (line: string) => lines.push(line));
    // O runner da suíte deixa só "error"; aqui o nível precisa deixar o info passar.
    const previous = { format: process.env.LOG_FORMAT, level: process.env.LOG_LEVEL };
    process.env.LOG_FORMAT = "json";
    process.env.LOG_LEVEL = "info";
    try {
      createLogger("teste").info("evento", {
        password: "hunter2",
        sessionToken: "abc",
        Authorization: "Bearer x",
        apiKey: "re_123",
        cookie: "session=1",
        sagaId: "s-1",
      });
    } finally {
      for (const [name, value] of [
        ["LOG_FORMAT", previous.format],
        ["LOG_LEVEL", previous.level],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }

    const payload = JSON.parse(lines[0]);
    for (const key of ["password", "sessionToken", "Authorization", "apiKey", "cookie"]) {
      assert.equal(payload[key], "[omitido]", key);
    }
    assert.equal(payload.sagaId, "s-1");
    for (const secret of ["hunter2", "abc", "Bearer x", "re_123", "session=1"])
      assert.ok(!lines[0].includes(secret), secret);
  });
});
