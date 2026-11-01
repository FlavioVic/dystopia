import type { Page } from "@playwright/test";
import { addFirstProductToCart, expect, fillCheckoutAddress, signUp, test } from "./fixtures";

/**
 * Cartão pelo Stripe DE VERDADE (modo de teste): o navegador tokeniza no
 * iframe do Stripe, o processo de pagamentos cria e confirma o PaymentIntent
 * na API real, e quem decide aprovar ou recusar é o Stripe, pelo número do
 * cartão de teste. Os outros testes de pagamento usam o simulado; este é o
 * que prova a integração.
 *
 * Só roda se o app testado tiver chave de teste do Stripe (o checkout mostra
 * "via Stripe · modo de teste"); sem chave, é pulado. Na stack do compose:
 * `STRIPE_PUBLISHABLE_KEY` e `STRIPE_SECRET_KEY` de teste no `.env`.
 */

/** Conta nova, um produto, checkout com cartão; pula se o app não tem Stripe. */
async function payWithStripe(page: Page, cardNumber: string) {
  const customer = await signUp(page);
  // No relatório: contra um ambiente compartilhado, é por ela que se acha (e apaga) o pedido.
  test.info().annotations.push({ type: "conta", description: customer.email });
  await addFirstProductToCart(page);
  await page.goto("/checkout");
  await fillCheckoutAddress(page);
  await page.locator('input[name="paymentMethod"][value="credit_card"]').check();

  test.skip(!(await page.getByText("via Stripe · modo de teste").isVisible()), "app sem chave de teste do Stripe");

  // O número do cartão nunca passa pelo nosso código: é digitado no iframe do Stripe.
  const card = page.frameLocator('iframe[name^="__privateStripeFrame"]').first();
  await card.locator('input[name="cardnumber"]').fill(cardNumber);
  await card.locator('input[name="exp-date"]').fill("12 / 34");
  await card.locator('input[name="cvc"]').fill("123");

  // Sem falha injetada pelo modo demonstração: a resposta é a do Stripe.
  const approve = page.locator('input[name="simulate"][value="approve"]');
  await approve.check();
  // Tira o foco do iframe do Stripe ANTES de clicar: o campo reage ao blur
  // (layout), e isso não pode acontecer entre o "apertar" e o "soltar" do clique.
  await approve.focus();
  await page.getByRole("button", { name: "Confirmar aquisição" }).click();
  await expectOrderPage(page);
}

/**
 * Foi para a página do pedido. Se ficou no checkout, falha dizendo o que a
 * tela mostra (erro do cartão no Stripe, do formulário) — "URL errada"
 * sozinho não diz nada no log da CI.
 */
async function expectOrderPage(page: Page) {
  try {
    await expect(page).toHaveURL(/\/pedido\/DYS-/, { timeout: 30_000 });
  } catch (error) {
    const shown = (await page.getByRole("alert").allInnerTexts()).map((text) => text.trim()).filter(Boolean);
    // Envio barrado pelo navegador não mostra nada na página: diz quais
    // campos ele considera inválidos e onde está o foco.
    const form = await page.evaluate(() => {
      const element = document.querySelector("form:has(button[type=submit])") as HTMLFormElement | null;
      const invalid = element
        ? Array.from(element.elements)
            .filter((field) => (field as HTMLInputElement).willValidate && !(field as HTMLInputElement).checkValidity())
            .map((field) => {
              const input = field as HTMLInputElement;
              return `${input.tagName.toLowerCase()}[name=${input.name}|class=${input.className}] "${input.validationMessage}" (${input.value.length} caracteres)`;
            })
        : ["formulário não encontrado"];
      const active = document.activeElement;
      return { invalid, active: active ? `${active.tagName.toLowerCase()}.${active.className}`.slice(0, 120) : "nenhum" };
    });
    throw new Error(
      `continuou no checkout; na tela: ${shown.join(" | ") || "nenhuma mensagem de erro"}; ` +
        `campos inválidos: ${form.invalid.join(" ; ") || "nenhum"}; foco: ${form.active}`,
      { cause: error },
    );
  }
}

test.describe("Stripe (modo de teste)", () => {
  test("cartão 4242: o Stripe aprova e o pedido fica pago", async ({ page }) => {
    await payWithStripe(page, "4242 4242 4242 4242");
    await expect(page.getByRole("heading", { name: "Aquisição registrada." })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/Aprovado.*Stripe, modo de teste/)).toBeVisible();
  });

  test("cartão recusado pelo Stripe: a saga desfaz tudo e o pedido aparece cancelado", async ({ page }) => {
    await payWithStripe(page, "4000 0000 0000 0002");
    await expect(page.getByRole("heading", { name: "Aquisição não concluída." })).toBeVisible({ timeout: 45_000 });
    // O motivo aparece no aviso do topo e na linha do tempo do pedido.
    await expect(page.getByText("O pagamento foi recusado pela operadora.").first()).toBeVisible();
    await expect(page.getByText(/foi desfeito/)).toBeVisible();
  });
});
