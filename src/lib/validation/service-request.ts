/**
 * Validação do pedido de orçamento (/servicos). Função pura — arquivo
 * `"use server"` só exporta async, então a regra mora aqui e é testada à parte.
 */

import { isServiceKind, type ServiceKind } from "@/lib/services-catalog";

export const MIN_DETAILS_LENGTH = 20;
export const MAX_DETAILS_LENGTH = 2_000;

export type ServiceRequestValues = {
  kind: ServiceKind | "";
  name: string;
  email: string;
  phone: string | null;
  details: string;
};

export type ServiceRequestParse = {
  errors: Record<string, string>;
  values: ServiceRequestValues;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Telefone brasileiro: DDD + 8 ou 9 dígitos. Guarda só os dígitos. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  return /^\d{10,11}$/.test(digits) ? digits : null;
}

export function parseServiceRequestForm(formData: FormData): ServiceRequestParse {
  const field = (name: string) => String(formData.get(name) ?? "").trim();
  const kindRaw = field("kind");
  const name = field("name").replace(/\s+/g, " ");
  const email = field("email").toLowerCase();
  const phoneRaw = field("phone");
  const details = field("details");

  const errors: Record<string, string> = {};
  const kind = isServiceKind(kindRaw) ? kindRaw : "";
  if (!kind) errors.kind = "Selecione o serviço.";
  if (name.length < 2) errors.name = "Informe seu nome.";
  if (!EMAIL_RE.test(email)) errors.email = "E-mail inválido.";

  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (phoneRaw && !phone) errors.phone = "Telefone inválido. Use DDD + número.";

  if (details.length < MIN_DETAILS_LENGTH) {
    errors.details = `Descreva a necessidade em pelo menos ${MIN_DETAILS_LENGTH} caracteres.`;
  } else if (details.length > MAX_DETAILS_LENGTH) {
    errors.details = `Máximo de ${MAX_DETAILS_LENGTH} caracteres.`;
  }

  return { errors, values: { kind, name, email, phone, details } };
}
