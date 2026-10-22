import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Testes de arquitetura: o que segura o desenho em pé quando o projeto
 * cresce. Serviço que importa `next/*` deixa de ser extraível; serviço que
 * importa outro serviço vira acoplamento escondido (quem orquestra é a saga).
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

function sourceFiles(dir: string): string[] {
  const absolute = path.join(ROOT, dir);
  const found: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const full = path.join(absolute, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(path.join(dir, entry)));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      found.push(path.join(dir, entry));
    }
  }
  return found;
}

function importsOf(relativePath: string): string[] {
  const content = readFileSync(path.join(ROOT, relativePath), "utf-8");
  return [...content.matchAll(/(?:from|import)\s+"([^"]+)"/g)].map((match) => match[1]);
}

describe("fronteiras da arquitetura", () => {
  const backendDirs = ["src/services", "src/saga", "src/queue"];

  it("serviços, saga e fila não dependem do Next (precisam rodar no worker)", () => {
    for (const dir of backendDirs) {
      for (const file of sourceFiles(dir)) {
        for (const specifier of importsOf(file)) {
          assert.ok(
            !specifier.startsWith("next/") && specifier !== "next",
            `${file} importa ${specifier} — isso prende o módulo ao runtime do Next`,
          );
        }
      }
    }
  });

  it("serviços não conhecem a borda HTTP (actions/data/componentes)", () => {
    for (const file of sourceFiles("src/services")) {
      for (const specifier of importsOf(file)) {
        assert.ok(
          !specifier.startsWith("@/lib/actions") &&
            !specifier.startsWith("@/lib/data") &&
            !specifier.startsWith("@/components") &&
            !specifier.startsWith("@/app"),
          `${file} importa ${specifier} — serviço não pode depender da borda`,
        );
      }
    }
  });

  it("um serviço não importa outro serviço (quem orquestra é a saga)", () => {
    for (const file of sourceFiles("src/services")) {
      const owner = file.split(path.sep)[2]; // src/services/<owner>/...
      for (const specifier of importsOf(file)) {
        if (!specifier.startsWith("@/services/")) continue;
        const target = specifier.split("/")[2];
        assert.equal(
          target,
          owner,
          `${file} importa ${specifier} — serviços só se encontram via saga`,
        );
      }
    }
  });

  it("serviços não importam o orquestrador (só a taxonomia de erro)", () => {
    for (const file of sourceFiles("src/services")) {
      for (const specifier of importsOf(file)) {
        if (!specifier.startsWith("@/saga")) continue;
        assert.equal(
          specifier,
          "@/saga/errors",
          `${file} importa ${specifier} — dependência invertida`,
        );
      }
    }
  });

  it("a fila não depende de uma saga específica", () => {
    for (const file of sourceFiles("src/queue")) {
      for (const specifier of importsOf(file)) {
        assert.ok(
          !specifier.startsWith("@/saga/definitions"),
          `${file} importa ${specifier} — a fila é genérica`,
        );
      }
    }
  });

  it("pagamentos é conhecido só pelo contrato (roda em processo próprio)", () => {
    // Quem monta processo (src/scripts) pluga os handlers; o resto do sistema
    // fala com pagamentos por mensagem, então só pode ver o contrato.
    const owner = path.join("src", "services", "payments");
    const composition = path.join("src", "scripts");
    for (const file of sourceFiles("src")) {
      if (file.startsWith(owner) || file.startsWith(composition)) continue;
      for (const specifier of importsOf(file)) {
        if (!specifier.startsWith("@/services/payments")) continue;
        assert.equal(
          specifier,
          "@/services/payments/contract",
          `${file} importa ${specifier} — fora do serviço, só o contrato`,
        );
      }
    }
  });

  it("a fila não importa serviço nenhum (handlers de serviço chegam por injeção)", () => {
    for (const file of sourceFiles("src/queue")) {
      for (const specifier of importsOf(file)) {
        assert.ok(!specifier.startsWith("@/services"), `${file} importa ${specifier} — a fila é genérica`);
      }
    }
  });

  it("o orquestrador não conhece a definição concreta (só o registry)", () => {
    for (const specifier of importsOf("src/saga/orchestrator.ts")) {
      assert.ok(
        !specifier.includes("definitions/"),
        `orchestrator importa ${specifier} — deve passar pelo registry`,
      );
    }
  });
});
