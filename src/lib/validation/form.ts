/**
 * Peças comuns dos formulários: `FormData` → schema Zod → resultado
 * discriminado. Quem usa só chega nos valores depois de checar `ok`, então
 * não existe "salvei o formulário inválido com valor padrão".
 *
 * Por que funções pequenas e não um schema genérico de FormData: cada campo
 * chega como texto (inclusive número e dinheiro), e o que importa é a
 * conversão — vazio não é zero, "19,90" é 1990 centavos.
 */

import { z } from "zod";
import { toCents } from "@/lib/money";

export type FormResult<T> =
  | { ok: true; values: T; errors: Record<string, never> }
  | { ok: false; errors: Record<string, string> };

/** Os campos pedidos como texto ("" quando ausentes) — a entrada dos schemas. */
export function formStrings<K extends string>(formData: FormData, keys: readonly K[]): Record<K, string> {
  return Object.fromEntries(keys.map((key) => [key, String(formData.get(key) ?? "")])) as Record<K, string>;
}

/** Checkbox marcado = campo presente no envio. */
export function checked(formData: FormData, key: string): boolean {
  return formData.get(key) != null;
}

/**
 * Roda o schema e devolve um erro por campo (o primeiro de cada um). A
 * entrada é `unknown` de propósito: vem do formulário, quem decide é o schema.
 */
export function parseForm<S extends z.ZodType>(schema: S, input: unknown): FormResult<z.output<S>> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, values: result.data, errors: {} };
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return { ok: false, errors };
}

/** Texto obrigatório (sem espaço nas pontas). */
export const requiredText = (message: string, min = 1) => z.string().trim().min(min, message);

/** Texto opcional: vazio vira `null`. */
export const optionalText = (max?: { length: number; message: string }) => {
  const base = z.string().trim();
  return (max ? base.max(max.length, max.message) : base).transform((value) => value || null);
};

/** Inteiro sem sinal digitado ("3"; não "3.5", "3x" nem ""), com mínimo. */
export const wholeNumber = (message: string, min = 0, max?: number) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,9}$/, message)
    .transform(Number)
    .pipe(max == null ? z.number().int().min(min, message) : z.number().int().min(min, message).max(max, message));

/** Dinheiro digitado ("19,90") em centavos. Vazio é erro, não zero. */
export const cents = (message: string, min = 0) =>
  z.string().transform((value, ctx) => {
    const parsed = toCents(value);
    if (parsed == null || parsed < min) {
      ctx.addIssue(message);
      return z.NEVER;
    }
    return parsed;
  });

/** Dinheiro opcional: vazio vira `fallback`. */
export const optionalCents = <F extends number | null>(message: string, fallback: F) =>
  z.string().transform((value, ctx): number | F => {
    if (!value.trim()) return fallback;
    const parsed = toCents(value);
    if (parsed == null) {
      ctx.addIssue(message);
      return z.NEVER;
    }
    return parsed;
  });

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** E-mail comparável: sem espaço nas pontas e em minúsculas. */
export const email = (message: string) => z.string().trim().toLowerCase().regex(EMAIL_RE, message);
