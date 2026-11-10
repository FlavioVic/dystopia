import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { valuesOf } from "../helpers/form";
import {
  parseForgotPasswordForm,
  parseLoginForm,
  parseResetPasswordForm,
  parseSignupForm,
} from "@/lib/validation/account";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("validação de conta", () => {
  it("cadastro válido sai normalizado", () => {
    const values = valuesOf(
      parseSignupForm(form({ name: "  Ana  ", email: "  Ana@Exemplo.DEV ", password: "12345678" })),
    );
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

  it("senha nova vai até 72 bytes (o que o bcrypt lê); acento conta mais de um", () => {
    const ok = (password: string) => parseSignupForm(form({ name: "Ana", email: "a@b.co", password })).ok;
    assert.equal(ok("a".repeat(72)), true);
    assert.equal(ok("a".repeat(73)), false);
    assert.equal(ok("é".repeat(36)), true, "36 × 2 bytes = 72");
    assert.equal(ok("é".repeat(37)), false, "37 letras, mas 74 bytes");
    const reset = { token: "t", password: "a".repeat(73), confirm: "a".repeat(73) };
    assert.deepEqual(Object.keys(parseResetPasswordForm(form(reset)).errors), ["password"]);
  });

  it("login aceita senha longa: quem cadastrou antes do limite ainda entra", () => {
    assert.equal(parseLoginForm(form({ email: "a@b.co", password: "a".repeat(100) })).ok, true);
  });

  it("login sem e-mail válido ou sem senha nem chega a consultar", () => {
    assert.equal(parseLoginForm(form({ email: "a@b.co", password: "x" })).ok, true);
    assert.equal(parseLoginForm(form({ email: "a@b", password: "x" })).ok, false);
    assert.equal(parseLoginForm(form({ email: "a@b.co", password: "" })).ok, false);
    assert.equal(valuesOf(parseLoginForm(form({ email: " A@B.CO ", password: "x" }))).email, "a@b.co");
  });

  it("esqueci a senha: e-mail normalizado, inválido aponta o campo", () => {
    assert.equal(valuesOf(parseForgotPasswordForm(form({ email: " Ana@Exemplo.DEV " }))).email, "ana@exemplo.dev");
    assert.deepEqual(Object.keys(parseForgotPasswordForm(form({ email: "sem-arroba" })).errors), ["email"]);
  });

  it("senha nova pelo link: mesma regra do cadastro, digitada duas vezes iguais", () => {
    const ok = { token: "t", password: "senha-nova-1", confirm: "senha-nova-1" };
    assert.equal(parseResetPasswordForm(form(ok)).ok, true);
    assert.deepEqual(Object.keys(parseResetPasswordForm(form({ ...ok, confirm: "outra-senha" })).errors), ["confirm"]);
    assert.deepEqual(Object.keys(parseResetPasswordForm(form({ ...ok, password: "curta", confirm: "curta" })).errors), [
      "password",
    ]);
    assert.deepEqual(Object.keys(parseResetPasswordForm(form({ ...ok, token: "" })).errors), ["token"]);
  });

  it("recusa e-mail acima do limite da RFC (fecha o 500 do índice único do Postgres)", () => {
    const grande = `${"a".repeat(250)}@x.co`; // 255 > 254
    assert.deepEqual(Object.keys(parseSignupForm(form({ name: "Ana", email: grande, password: "12345678" })).errors), [
      "email",
    ]);
    const noLimite = `${"a".repeat(240)}@x.co`; // 245 ≤ 254
    assert.equal(parseSignupForm(form({ name: "Ana", email: noLimite, password: "12345678" })).ok, true);
  });

  it("recusa nome absurdamente longo", () => {
    assert.ok(parseSignupForm(form({ name: "A".repeat(121), email: "a@b.co", password: "12345678" })).errors.name);
    assert.equal(parseSignupForm(form({ name: "A".repeat(120), email: "a@b.co", password: "12345678" })).ok, true);
  });

  it("login com e-mail longo demais dá a mesma mensagem genérica (não vaza no comprimento)", () => {
    const grande = `${"a".repeat(300)}@x.co`;
    assert.equal(parseLoginForm(form({ email: grande, password: "x" })).errors.email, "E-mail ou senha inválidos.");
  });
});
