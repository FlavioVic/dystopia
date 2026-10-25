import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRichText } from "@/lib/assistant/rich-text";

describe("texto do assistente na tela", () => {
  it("link para página do site vira link", () => {
    assert.deepEqual(parseRichText("Veja o [Ryzen 5](/produto/ryzen-5) agora."), [
      { type: "text", text: "Veja o " },
      { type: "link", text: "Ryzen 5", href: "/produto/ryzen-5" },
      { type: "text", text: " agora." },
    ]);
  });

  it("vários links e caminho com busca", () => {
    const segments = parseRichText("[A](/produtos?q=rtx) e [B](/conta)");
    assert.deepEqual(segments.filter((s) => s.type === "link").map((s) => (s as { href: string }).href), ["/produtos?q=rtx", "/conta"]);
  });

  it("link externo, protocolo-relativo ou javascript: fica só o texto", () => {
    for (const href of ["https://golpe.dev/pix", "//golpe.dev", "javascript:alert(1)", "data:text/html,x"]) {
      const segments = parseRichText(`[Pague aqui](${href})`);
      assert.ok(segments.every((segment) => segment.type === "text"), href);
      assert.ok(!segments.some((segment) => segment.text.includes("golpe")), href);
    }
  });

  it("HTML vindo do modelo é texto, nunca marcação", () => {
    assert.deepEqual(parseRichText("<img src=x onerror=alert(1)>"), [{ type: "text", text: "<img src=x onerror=alert(1)>" }]);
  });

  it("negrito de markdown some, o texto fica", () => {
    assert.deepEqual(parseRichText("Frete **grátis** acima de R$ 149,90."), [{ type: "text", text: "Frete grátis acima de R$ 149,90." }]);
  });
});
