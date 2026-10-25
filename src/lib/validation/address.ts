/**
 * Endereço — compartilhado entre o checkout e a agenda da conta.
 */

import { z } from "zod";
import { formStrings, optionalText, parseForm, requiredText } from "./form";

export const ZIP_PATTERN = /^\d{5}-?\d{3}$/;
export const UF_PATTERN = /^[A-Z]{2}$/;

/** Normaliza para `00000-000` — o banco guarda um formato só. */
export function normalizeZipCode(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 8) return raw.trim();
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

const addressSchema = z.object({
  label: z.string().trim().transform((value) => value || "Entrega"),
  recipientName: requiredText("Informe o destinatário.", 2),
  street: requiredText("Informe a rua."),
  number: requiredText("Nº"),
  complement: optionalText(),
  neighborhood: requiredText("Informe o bairro."),
  city: requiredText("Informe a cidade."),
  state: z.string().trim().toUpperCase().regex(UF_PATTERN, "UF"),
  zipCode: z.string().transform(normalizeZipCode).pipe(z.string().regex(ZIP_PATTERN, "CEP inválido (00000-000).")),
});

export type AddressFormValues = z.output<typeof addressSchema>;

const FIELDS = ["label", "recipientName", "street", "number", "complement", "neighborhood", "city", "state", "zipCode"] as const;

export function parseAddressForm(formData: FormData) {
  return parseForm(addressSchema, formStrings(formData, FIELDS));
}

/** Uma linha legível — usada na lista da conta e no resumo do checkout. */
export function formatAddress(address: Omit<AddressFormValues, "label">): string {
  const complement = address.complement ? ` · ${address.complement}` : "";
  return `${address.street}, ${address.number}${complement} — ${address.neighborhood}, ${address.city}/${address.state} · CEP ${address.zipCode}`;
}
