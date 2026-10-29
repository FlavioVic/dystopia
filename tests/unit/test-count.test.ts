import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { TEST_COUNT } from "@/lib/site";

/** /sobre mostra quantos testes a loja tem: o número tem que ser verdade. */
describe("número de testes publicado", () => {
  it("TEST_COUNT bate com os casos da suíte", () => {
    const root = path.resolve(import.meta.dirname, "..");
    let cases = 0;
    for (const dir of ["unit", "integration", "e2e"]) {
      let files: string[];
      try {
        files = readdirSync(path.join(root, dir)).filter((file) => /\.(test|spec)\.ts$/.test(file));
      } catch {
        continue;
      }
      for (const file of files) {
        cases += (readFileSync(path.join(root, dir, file), "utf-8").match(/^\s*(?:it|test)\(/gm) ?? []).length;
      }
    }
    assert.equal(TEST_COUNT, cases, `atualize TEST_COUNT em src/lib/site.ts para ${cases}`);
  });
});
