import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { valuesOf } from "../helpers/form";
import { parseLoginForm, parseSignupForm } from "@/lib/validation/account";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("validação de conta", () => {
  it("cadastro válido sai normalizado", () => {
    const values = valuesOf(parseSignupForm(
      form({ name: "  Ana  ", email: "  Ana@Exemplo.DEV ", password: "12345678" }),
    ));
    assert.deepEqual(values, { name: "Ana", email: "ana@exemplo.dev", password: "12345678" });
  });

  it("aponta cada campo inválido", () => {
    const { errors } = parseSignupForm(form({ name: "A", email: "sem-arroba", password: "curta" }));
    assert.deepEqual(Object.keys(errors).sort(), ["email", "name", "password"]);
  });

  it("senha não é aparada: espaço faz parte dela", () => {
    const values = valuesOf(parseSignupForm(form({ name: "Ana", email: "a@b.co", password: " 1234567 " })));
    assert.equal(values.password, " 1234567 ");
  });

  it("login sem e-mail válido ou sem senha nem chega a consultar", () => {
    assert.equal(parseLoginForm(form({ email: "a@b.co", password: "x" })).ok, true);
    assert.equal(parseLoginForm(form({ email: "a@b", password: "x" })).ok, false);
    assert.equal(parseLoginForm(form({ email: "a@b.co", password: "" })).ok, false);
    assert.equal(valuesOf(parseLoginForm(form({ email: " A@B.CO ", password: "x" }))).email, "a@b.co");
  });
});
