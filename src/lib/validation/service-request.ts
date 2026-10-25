/**
 * Pedido de orçamento (/servicos).
 */

import { z } from "zod";
import { isServiceKind, type ServiceKind } from "@/lib/services-catalog";
import { email, formStrings, parseForm } from "./form";

export const MIN_DETAILS_LENGTH = 20;
export const MAX_DETAILS_LENGTH = 2_000;

/** Telefone brasileiro: DDD + 8 ou 9 dígitos. Guarda só os dígitos. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  return /^\d{10,11}$/.test(digits) ? digits : null;
}

const serviceRequestSchema = z.object({
  kind: z
    .string()
    .trim()
    .refine((value): value is ServiceKind => isServiceKind(value), "Selecione o serviço.")
    .transform((value) => value as ServiceKind),
  name: z.string().trim().transform((value) => value.replace(/\s+/g, " ")).pipe(z.string().min(2, "Informe seu nome.")),
  email: email("E-mail inválido."),
  phone: z.string().transform((value, ctx) => {
    if (!value.trim()) return null;
    const phone = normalizePhone(value);
    if (!phone) {
      ctx.addIssue("Telefone inválido. Use DDD + número.");
      return z.NEVER;
    }
    return phone;
  }),
  details: z
    .string()
    .trim()
    .min(MIN_DETAILS_LENGTH, `Descreva a necessidade em pelo menos ${MIN_DETAILS_LENGTH} caracteres.`)
    .max(MAX_DETAILS_LENGTH, `Máximo de ${MAX_DETAILS_LENGTH} caracteres.`),
});

export type ServiceRequestValues = z.output<typeof serviceRequestSchema>;

export function parseServiceRequestForm(formData: FormData) {
  return parseForm(serviceRequestSchema, formStrings(formData, ["kind", "name", "email", "phone", "details"]));
}
