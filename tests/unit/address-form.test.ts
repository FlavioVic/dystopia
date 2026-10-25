import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { valuesOf } from "../helpers/form";
import { formatAddress, normalizeZipCode, parseAddressForm } from "@/lib/validation/address";

function form(values: Record<string, string | undefined>): FormData {
  const data = new FormData();
  const base: Record<string, string> = {
    recipientName: "Flávio Victor",
    zipCode: "01310-100",
    street: "Av Paulista",
    number: "1000",
    neighborhood: "Bela Vista",
    city: "São Paulo",
    state: "sp",
  };
  for (const [key, value] of Object.entries({ ...base, ...values })) {
    if (value !== undefined) data.set(key, value);
  }
  return data;
}

describe("CEP", () => {
  it("normaliza para 00000-000", () => {
    assert.equal(normalizeZipCode("01310100"), "01310-100");
    assert.equal(normalizeZipCode("01310-100"), "01310-100");
    assert.equal(normalizeZipCode(" 01310.100 "), "01310-100");
  });

  it("devolve o original quando não tem 8 dígitos (para virar erro de validação)", () => {
    assert.equal(normalizeZipCode("123"), "123");
    assert.equal(normalizeZipCode(""), "");
  });
});

describe("validação de endereço", () => {
  it("aceita endereço completo e normaliza UF e CEP", () => {
    const values = valuesOf(parseAddressForm(form({ zipCode: "01310100", complement: "Apto 42" })));
    assert.equal(values.state, "SP", "UF vai para maiúscula");
    assert.equal(values.zipCode, "01310-100");
    assert.equal(values.complement, "Apto 42");
    assert.equal(values.label, "Entrega", "apelido tem padrão");
  });

  it("complemento vazio é null e apelido customizado é respeitado", () => {
    const values = valuesOf(parseAddressForm(form({ label: "Casa" })));
    assert.equal(values.complement, null);
    assert.equal(values.label, "Casa");
  });

  it("cobra os campos obrigatórios", () => {
    const { errors } = parseAddressForm(
      form({ recipientName: "A", street: "", number: "", neighborhood: "", city: "", state: "" }),
    );
    assert.equal(errors.recipientName, "Informe o destinatário.");
    assert.equal(errors.street, "Informe a rua.");
    assert.equal(errors.number, "Nº");
    assert.equal(errors.neighborhood, "Informe o bairro.");
    assert.equal(errors.city, "Informe a cidade.");
    assert.equal(errors.state, "UF");
  });

  it("recusa CEP e UF malformados", () => {
    assert.equal(parseAddressForm(form({ zipCode: "123" })).errors.zipCode, "CEP inválido (00000-000).");
    assert.equal(parseAddressForm(form({ zipCode: "abcdefgh" })).errors.zipCode, "CEP inválido (00000-000).");
    assert.equal(parseAddressForm(form({ state: "São Paulo" })).errors.state, "UF");
    assert.equal(parseAddressForm(form({ state: "s" })).errors.state, "UF");
  });

  it("formata o endereço em uma linha legível", () => {
    const values = valuesOf(parseAddressForm(form({ complement: "Apto 42" })));
    const line = formatAddress(values);
    assert.match(line, /Av Paulista, 1000/);
    assert.match(line, /Apto 42/);
    assert.match(line, /São Paulo\/SP/);
    assert.match(line, /CEP 01310-100/);
  });
});
