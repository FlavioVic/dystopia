import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveClientIp, UNTRUSTED_IP } from "@/lib/request-ip";

const spoofed = (name: string) => ({ "x-real-ip": "6.6.6.6", "x-forwarded-for": "7.7.7.7, 10.0.0.1" })[name];

describe("IP do cliente (limite de tentativas)", () => {
  it("produção sem proxy confiável não acredita no header que o cliente manda", () => {
    assert.equal(resolveClientIp(spoofed, { NODE_ENV: "production" }), UNTRUSTED_IP);
  });

  it("na Vercel ou atrás de proxy declarado, usa o IP que o proxy escreveu", () => {
    assert.equal(resolveClientIp(spoofed, { NODE_ENV: "production", VERCEL: "1" }), "6.6.6.6");
    assert.equal(resolveClientIp(spoofed, { NODE_ENV: "production", TRUST_PROXY_HEADERS: "1" }), "6.6.6.6");
  });

  it("sem X-Real-IP, o primeiro do X-Forwarded-For", () => {
    const onlyForwarded = (name: string) => (name === "x-forwarded-for" ? " 7.7.7.7 , 10.0.0.1" : null);
    assert.equal(resolveClientIp(onlyForwarded, { TRUST_PROXY_HEADERS: "1", NODE_ENV: "production" }), "7.7.7.7");
  });

  it("dev e testes confiam (não há proxy na frente)", () => {
    assert.equal(resolveClientIp(spoofed, { NODE_ENV: "development" }), "6.6.6.6");
  });
});

describe("limite configurável por ambiente", () => {
  it("usa o valor da variável só se for inteiro positivo; senão, o de produção", async () => {
    const { limitFromEnv } = await import("@/lib/rate-limit-config");
    const name = "LIMITE_DE_TESTE";
    for (const [raw, expected] of [["200", 200], ["0", 5], ["-3", 5], ["2.5", 5], ["abc", 5], [undefined, 5]] as const) {
      if (raw === undefined) delete process.env[name];
      else process.env[name] = raw;
      assert.equal(limitFromEnv(name, 5), expected, String(raw));
    }
    delete process.env[name];
  });
});
