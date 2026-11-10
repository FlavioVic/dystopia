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

  it("atrás do CloudFront, vale o endereço que o CloudFront escreveu, nunca o X-Forwarded-For", () => {
    const env = { NODE_ENV: "production", TRUST_PROXY_HEADERS: "cloudfront" };
    // O cliente forjou X-Real-IP e X-Forwarded-For; o CloudFront acrescentou o real.
    const viaCloudFront = (name: string) =>
      ({
        "x-real-ip": "6.6.6.6",
        "x-forwarded-for": "7.7.7.7, 203.0.113.9, 130.176.0.1",
        "cloudfront-viewer-address": "203.0.113.9:51234",
      })[name];
    assert.equal(resolveClientIp(viaCloudFront, env), "203.0.113.9");

    const ipv6 = (name: string) => (name === "cloudfront-viewer-address" ? "2001:db8::1:46532" : null);
    assert.equal(resolveClientIp(ipv6, env), "2001:db8:0:0::/64", "IPv6 vira o bloco /64");

    // Sem o header (request que não veio pelo CloudFront): falha fechado.
    assert.equal(resolveClientIp(spoofed, env), UNTRUSTED_IP);
  });

  it("IPv6 conta pelo bloco /64: trocar de endereço dentro dele não ganha contador novo", () => {
    const env = { NODE_ENV: "production", VERCEL: "1" };
    const from = (ip: string) => resolveClientIp((name) => (name === "x-real-ip" ? ip : null), env);
    assert.equal(from("2001:db8:abcd:12:1:2:3:4"), "2001:db8:abcd:12::/64");
    assert.equal(from("2001:db8:abcd:12:ffff:ffff:ffff:ffff"), from("2001:db8:abcd:12:1:2:3:4"));
    assert.notEqual(from("2001:db8:abcd:13::1"), from("2001:db8:abcd:12::1"), "outro /64, outro contador");
    assert.equal(
      from("2001:0db8:0000:0012:0000:0000:0000:0001"),
      "2001:db8:0:12::/64",
      "forma longa e curta dão a mesma chave",
    );
    assert.equal(from("::ffff:198.51.100.9"), "198.51.100.9", "IPv4 escrito como IPv6 volta a ser IPv4");
    assert.equal(from("fe80::1%eth0"), "fe80:0:0:0::/64");
    assert.equal(from("64:ff9b::192.0.2.33"), "64:ff9b:0:0::/64");
    assert.equal(from("203.0.113.7"), "203.0.113.7", "IPv4 fica como está");
  });

  it("dev e testes confiam (não há proxy na frente)", () => {
    assert.equal(resolveClientIp(spoofed, { NODE_ENV: "development" }), "6.6.6.6");
  });
});

describe("limite configurável por ambiente", () => {
  it("usa o valor da variável só se for inteiro positivo; senão, o de produção", async () => {
    const { limitFromEnv } = await import("@/lib/rate-limit-config");
    const name = "LIMITE_DE_TESTE";
    for (const [raw, expected] of [
      ["200", 200],
      ["0", 5],
      ["-3", 5],
      ["2.5", 5],
      ["abc", 5],
      [undefined, 5],
    ] as const) {
      if (raw === undefined) delete process.env[name];
      else process.env[name] = raw;
      assert.equal(limitFromEnv(name, 5), expected, String(raw));
    }
    delete process.env[name];
  });
});
