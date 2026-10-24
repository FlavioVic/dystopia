/**
 * Formulários de conta (cadastro e login). O arquivo `"use server"` não pode
 * exportar nada síncrono, então a validação mora aqui, testável.
 */

import { z } from "zod";
import { email, formStrings, parseForm, requiredText } from "./form";

export const MIN_NAME_LENGTH = 2;
export const MIN_PASSWORD_LENGTH = 8;

const signupSchema = z.object({
  name: requiredText(`Informe seu nome (mín. ${MIN_NAME_LENGTH} caracteres).`, MIN_NAME_LENGTH),
  email: email("Informe um e-mail válido."),
  // Senha não é aparada: espaço faz parte dela.
  password: z.string().min(MIN_PASSWORD_LENGTH, `A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`),
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
