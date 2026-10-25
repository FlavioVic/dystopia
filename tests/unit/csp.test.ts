import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCsp } from "@/lib/csp";

function directive(csp: string, name: string): string[] {
  const found = csp.split("; ").find((part) => part.startsWith(`${name} `));
  return found ? found.split(" ").slice(1) : [];
}

describe("CSP", () => {
  it("script só com o nonce do request, sem inline nem eval em produção", () => {
    const scripts = directive(buildCsp("abc123"), "script-src");
    assert.ok(scripts.includes("'nonce-abc123'"));
    assert.ok(scripts.includes("'strict-dynamic'"));
    assert.ok(!scripts.includes("'unsafe-inline'"));
    assert.ok(!scripts.includes("'unsafe-eval'"));
  });

  it("dev libera eval (stack de erro do React) e websocket do HMR", () => {
    const csp = buildCsp("n", { dev: true });
    assert.ok(directive(csp, "script-src").includes("'unsafe-eval'"));
    assert.ok(directive(csp, "connect-src").includes("ws:"));
    assert.ok(!csp.includes("upgrade-insecure-requests"));
  });

  it("bloqueia iframe da loja, plugin e troca de base", () => {
    const csp = buildCsp("n");
    assert.deepEqual(directive(csp, "frame-ancestors"), ["'none'"]);
    assert.deepEqual(directive(csp, "object-src"), ["'none'"]);
    assert.deepEqual(directive(csp, "base-uri"), ["'self'"]);
  });

  it("libera só o necessário pro Stripe Elements", () => {
    const csp = buildCsp("n");
    assert.deepEqual(directive(csp, "frame-src"), ["https://js.stripe.com", "https://hooks.stripe.com"]);
    assert.ok(directive(csp, "connect-src").includes("https://api.stripe.com"));
  });
});
