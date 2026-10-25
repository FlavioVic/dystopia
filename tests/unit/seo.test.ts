import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { JsonLd, listingCanonical } from "@/lib/seo";

describe("SEO", () => {
  it("JSON-LD com texto do banco não fecha a tag script", () => {
    const html = renderToStaticMarkup(JsonLd({ data: { name: "</script><script>alert(1)</script>" } }));
    assert.equal(html.match(/<\/script>/g)?.length, 1, "só o fechamento da própria tag");
    assert.match(html, /\\u003c\/script>/);
  });

  it("canonical de listagem: página 1 sem parâmetro, demais com a própria página, lixo vira 1", () => {
    assert.deepEqual(listingCanonical("/produtos", undefined), { canonical: "/produtos" });
    assert.deepEqual(listingCanonical("/produtos", "1"), { canonical: "/produtos" });
    assert.deepEqual(listingCanonical("/produtos", ["3"]), { canonical: "/produtos?pagina=3" });
    assert.deepEqual(listingCanonical("/produtos", "abc"), { canonical: "/produtos" });
  });
});
