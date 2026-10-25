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
  // `src/composition` também: o worker de pé (container) monta a fila por ele.
  const backendDirs = ["src/services", "src/saga", "src/queue", "src/composition"];

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
    // Quem monta processo (src/scripts) ou o worker embutido (src/composition)
    // pluga os handlers; o resto do sistema fala com pagamentos por mensagem,
    // então só pode ver o contrato.
    const owner = path.join("src", "services", "payments");
    const composition = [path.join("src", "scripts"), path.join("src", "composition")];
    for (const file of sourceFiles("src")) {
      if (file.startsWith(owner) || composition.some((dir) => file.startsWith(dir))) continue;
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

  it("Server Action não escreve no banco: valida a entrada e chama o serviço", () => {
    // Leitura para decidir a resposta (guarda, redirect) é ok, e abrir uma
    // transação para compor serviços também (é o outbox do checkout). Mutação
    // na borda não: vira regra fora do serviço, sem teste, e com o "lê,
    // decide, escreve" que dá corrida.
    for (const file of sourceFiles(path.join("src", "lib", "actions"))) {
      const content = readFileSync(path.join(ROOT, file), "utf-8");
      const writes = [...content.matchAll(/\b(?:db|tx)\s*\.\s*(insert|update|delete)\s*\(/g)];
      assert.deepEqual(
        writes.map((match) => match[1]),
        [],
        `${file} escreve no banco direto — mova a escrita para um serviço`,
      );
    }
  });

  it("toda Server Action do admin começa checando o papel", () => {
    // Server Action é endpoint público: o layout protegido não cobre quem
    // chama a action direto. A checagem tem que ser a primeira coisa.
    const content = readFileSync(path.join(ROOT, "src", "lib", "actions", "admin.ts"), "utf-8");
    // O corpo começa na `{` que fecha a linha da assinatura (o tipo de retorno
    // pode ter `{ … }` no meio da linha).
    const actions = [...content.matchAll(/export async function (\w+)[\s\S]*?\{\n\s*([^\n]*)/g)];
    assert.ok(actions.length > 0);
    for (const [, name, firstLine] of actions) {
      assert.equal(firstLine.trim(), "await ensureAdmin();", `${name} não começa com ensureAdmin()`);
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
