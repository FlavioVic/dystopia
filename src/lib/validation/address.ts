/**
 * Validação de endereço — pura, compartilhada entre o checkout e o cadastro
 * de endereços da conta. Antes isso vivia duplicado dentro da Server Action
 * do checkout (e por isso não tinha teste).
 */

export type AddressFormValues = {
  label: string;
  recipientName: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
};

export type AddressFormParse = {
  errors: Record<string, string>;
  values: AddressFormValues;
};

export const ZIP_PATTERN = /^\d{5}-?\d{3}$/;
export const UF_PATTERN = /^[A-Z]{2}$/;

/** Normaliza pra `00000-000` — o banco guarda um formato só. */
export function normalizeZipCode(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 8) return raw.trim();
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

function field(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export function parseAddressForm(formData: FormData): AddressFormParse {
  const values: AddressFormValues = {
    label: field(formData, "label") || "Entrega",
    recipientName: field(formData, "recipientName"),
    street: field(formData, "street"),
    number: field(formData, "number"),
    complement: field(formData, "complement") || null,
    neighborhood: field(formData, "neighborhood"),
    city: field(formData, "city"),
    state: field(formData, "state").toUpperCase(),
    zipCode: normalizeZipCode(field(formData, "zipCode")),
  };

  const errors: Record<string, string> = {};
  if (values.recipientName.length < 2) errors.recipientName = "Informe o destinatário.";
  if (!ZIP_PATTERN.test(values.zipCode)) errors.zipCode = "CEP inválido (00000-000).";
  if (!values.street) errors.street = "Informe a rua.";
  if (!values.number) errors.number = "Nº";
  if (!values.neighborhood) errors.neighborhood = "Informe o bairro.";
  if (!values.city) errors.city = "Informe a cidade.";
  if (!UF_PATTERN.test(values.state)) errors.state = "UF";

  return { errors, values };
}

/** Uma linha legível — usada na lista da conta e no resumo do checkout. */
export function formatAddress(address: Omit<AddressFormValues, "label">): string {
  const complement = address.complement ? ` · ${address.complement}` : "";
  return `${address.street}, ${address.number}${complement} — ${address.neighborhood}, ${address.city}/${address.state} · CEP ${address.zipCode}`;
}
