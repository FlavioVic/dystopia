import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizePhone, parseServiceRequestForm } from "@/lib/validation/service-request";
import { generateProtocol } from "@/services/service-requests";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const valid = {
  kind: "montagem",
  name: "  Ana   Souza ",
  email: "ANA@Exemplo.com",
  phone: "",
  details: "Montar um PC com RTX 5070 e Ryzen 7 9800X3D.",
};

describe("formulário de orçamento", () => {
  it("aceita o pedido completo e normaliza nome e e-mail", () => {
    const { errors, values } = parseServiceRequestForm(form(valid));
    assert.deepEqual(errors, {});
    assert.equal(values.name, "Ana Souza");
    assert.equal(values.email, "ana@exemplo.com");
    assert.equal(values.phone, null);
  });

  it("recusa serviço que não está no catálogo", () => {
    const { errors, values } = parseServiceRequestForm(form({ ...valid, kind: "hackear" }));
    assert.ok(errors.kind);
    assert.equal(values.kind, "");
  });

  it("exige descrição mínima e e-mail válido", () => {
    const { errors } = parseServiceRequestForm(form({ ...valid, details: "pc lento", email: "ana@" }));
    assert.ok(errors.details);
    assert.ok(errors.email);
  });

  it("telefone é opcional, mas se vier tem que ser DDD + número", () => {
    assert.ok(parseServiceRequestForm(form({ ...valid, phone: "1234" })).errors.phone);
    assert.equal(parseServiceRequestForm(form({ ...valid, phone: "(11) 91234-5678" })).values.phone, "11912345678");
  });
});

describe("telefone", () => {
  it("aceita fixo e celular, com ou sem +55", () => {
    assert.equal(normalizePhone("(11) 3456-7890"), "1134567890");
    assert.equal(normalizePhone("+55 11 91234-5678"), "11912345678");
    assert.equal(normalizePhone("91234-5678"), null);
  });
});

describe("protocolo", () => {
  it("tem formato fixo DYS-S + 6 dígitos", () => {
    assert.equal(generateProtocol(() => 42), "DYS-S000042");
    assert.match(generateProtocol(), /^DYS-S\d{6}$/);
  });
});
