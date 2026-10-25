import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTACT_EMAIL } from "@/lib/site";
import { escapeHtml, orderConfirmationEmail, serviceRequestAlertEmail } from "@/services/notifications/templates";

const SITE = "https://loja.dev";

describe("e-mail de compra", () => {
  const email = orderConfirmationEmail(
    {
      orderNumber: "DYS-2026-000042",
      customerName: "Ana",
      totalCents: 401_980,
      paymentMethod: "pix",
      items: [
        { name: "Processador Ryzen 5 9600X", quantity: 2, unitPriceCents: 169_990 },
        { name: "Cooler", quantity: 1, unitPriceCents: 62_000 },
      ],
    },
    SITE,
  );

  it("assunto na voz da marca e texto puro junto, para cliente sem HTML", () => {
    assert.equal(email.subject, "Aquisição DYS-2026-000042 registrada");
    assert.match(email.text, /2x Processador Ryzen 5 9600X/);
    assert.match(email.text, /Pagamento: Pix/);
    assert.match(email.text, /https:\/\/loja\.dev\/pedido\/DYS-2026-000042/);
    assert.ok(!email.subject.includes("!") && !email.text.includes("!"), "sem exclamação");
  });

  it("HTML com a identidade: assinatura, selo, itens com total da linha, total e botão para o pedido", () => {
    assert.match(email.html, /src="https:\/\/loja\.dev\/email\/lockup\.png"[^>]*alt="DYSTOPIA"/);
    assert.match(email.html, />Pago</);
    assert.match(email.html, /2 × R\$\s1\.699,90/);
    assert.match(email.html, /R\$\s3\.399,80/, "total da linha");
    assert.match(email.html, /R\$\s4\.019,80/, "total do pedido");
    assert.match(email.html, /href="https:\/\/loja\.dev\/pedido\/DYS-2026-000042"[^>]*>Ver pedido</);
    assert.match(email.html, /#c8102e/, "vermelho de ação da paleta");
    assert.ok(email.html.includes(CONTACT_EMAIL));
  });

  it("sem preço unitário (notificação montada por código antigo), não quebra", () => {
    const old = orderConfirmationEmail({ orderNumber: "DYS-1", customerName: "A", totalCents: 100, items: [{ name: "X", quantity: 1 }] }, SITE);
    assert.ok(!old.html.includes("undefined") && !old.html.includes("NaN"));
  });
});

describe("e-mail de orçamento", () => {
  const input = {
    protocol: "DYS-S000123",
    serviceName: "Manutenção",
    name: "Ana Souza",
    email: "ana@exemplo.com",
    phone: null,
    details: "PC desligando.\nAcontece em jogo.",
  };

  it("painel com os dados, descrição, botão para o painel e responder por e-mail", () => {
    const email = serviceRequestAlertEmail(input, SITE);
    assert.equal(email.subject, "Orçamento DYS-S000123: Manutenção");
    assert.match(email.html, />Novo</);
    assert.match(email.html, /não informado/);
    assert.match(email.html, /href="https:\/\/loja\.dev\/admin\/orcamentos"[^>]*>Abrir no painel</);
    assert.match(email.html, /href="mailto:ana@exemplo\.com\?subject=Or%C3%A7amento%20DYS-S000123"/);
    assert.match(email.text, /Andamento em https:\/\/loja\.dev\/admin\/orcamentos/);
  });

  it("o formulário é público: o que a pessoa digitou nunca vira marcação no e-mail", () => {
    const email = serviceRequestAlertEmail(
      { ...input, name: '<img src=x onerror="alert(1)">', details: "</p><script>roubar()</script>", email: 'a@b.c" onclick="x' },
      SITE,
    );
    assert.ok(!email.html.includes("<script>"));
    assert.ok(!email.html.includes("<img src=x"));
    assert.ok(!email.html.includes('" onclick="'));
    assert.match(email.html, /&lt;script&gt;roubar\(\)&lt;\/script&gt;/);
  });
});

describe("escape", () => {
  it("cobre os cinco caracteres de HTML", () => {
    assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });
});
