import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { CONTACT_EMAIL } from "@/lib/site";

const ROOT = path.resolve(import.meta.dirname, "../..");

function textFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir))) {
    const relative = path.join(dir, entry);
    if (statSync(path.join(ROOT, relative)).isDirectory()) found.push(...textFiles(relative));
    else if (/\.(ts|tsx|md|mjs|yml|example)$/.test(entry)) found.push(relative);
  }
  return found;
}

describe("contato público", () => {
  it("o único Gmail no repositório é o da loja — e-mail pessoal não vaza (o repo é público)", () => {
    const files = [...textFiles("src"), ...textFiles("tests"), ...textFiles("docs"), "README.md", ".env.example"];
    const leaks: string[] = [];
    for (const file of files) {
      for (const [address] of readFileSync(path.join(ROOT, file), "utf-8").matchAll(/[\w.+-]+@gmail\.com/gi)) {
        if (address.toLowerCase() !== CONTACT_EMAIL) leaks.push(`${file}: ${address}`);
      }
    }
    assert.deepEqual(leaks, []);
  });
});
