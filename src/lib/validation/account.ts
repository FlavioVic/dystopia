/**
 * Formulários de conta (cadastro e login). O arquivo `"use server"` não pode
 * exportar nada síncrono, então a validação mora aqui, testável.
 */

import { z } from "zod";
import { email, formStrings, parseForm, requiredText } from "./form";

export const MIN_NAME_LENGTH = 2;
export const MIN_PASSWORD_LENGTH = 8;
/**
 * O bcrypt só lê os primeiros 72 bytes da senha: o resto seria ignorado sem
 * aviso (duas senhas longas com o mesmo começo valeriam a mesma coisa). A
 * OWASP recomenda recusar acima disso. É byte, não letra: acento e emoji
 * ocupam mais de um.
 */
export const MAX_PASSWORD_BYTES = 72;

/** Senha nova (cadastro e redefinição). Não é aparada: espaço faz parte dela. */
const newPassword = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`)
  .refine(
    (value) => new TextEncoder().encode(value).length <= MAX_PASSWORD_BYTES,
    `A senha pode ter até ${MAX_PASSWORD_BYTES} caracteres (acento e emoji contam como mais de um).`,
  );

const signupSchema = z.object({
  name: requiredText(`Informe seu nome (mín. ${MIN_NAME_LENGTH} caracteres).`, MIN_NAME_LENGTH),
  email: email("Informe um e-mail válido."),
  password: newPassword,
});

const loginSchema = z.object({
  email: email("E-mail ou senha inválidos."),
  password: z.string().min(1, "E-mail ou senha inválidos."),
});

export type SignupValues = z.output<typeof signupSchema>;

export function parseSignupForm(formData: FormData) {
  return parseForm(signupSchema, formStrings(formData, ["name", "email", "password"]));
}

/** Login só rejeita o que nem vale consultar; o resto quem decide é a senha. */
export function parseLoginForm(formData: FormData) {
  return parseForm(loginSchema, formStrings(formData, ["email", "password"]));
}

const forgotPasswordSchema = z.object({
  email: email("Informe um e-mail válido."),
});

/** Pedido do link: só o e-mail. */
export function parseForgotPasswordForm(formData: FormData) {
  return parseForm(forgotPasswordSchema, formStrings(formData, ["email"]));
}

const resetPasswordSchema = z
  .object({
    token: z.string().min(1, "Link incompleto. Peça outro."),
    password: newPassword,
    confirm: z.string(),
  })
  .refine((values) => values.password === values.confirm, {
    path: ["confirm"],
    message: "As duas senhas não são iguais.",
  });

/** Senha nova pelo link: a mesma regra do cadastro, digitada duas vezes. */
export function parseResetPasswordForm(formData: FormData) {
  return parseForm(resetPasswordSchema, formStrings(formData, ["token", "password", "confirm"]));
}
