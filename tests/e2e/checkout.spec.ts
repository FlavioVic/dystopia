import type { Page } from "@playwright/test";
import { addFirstProductToCart, expect, fillCheckoutAddress, signUp, test } from "./fixtures";

type Outcome = "approve" | "decline" | "flaky_once";

/** Conta nova → um produto no carrinho → checkout com o resultado do modo demonstração. */
async function buy(page: Page, outcome: Outcome, options: { coupon?: string } = {}) {
  await signUp(page);
  // Processadores do seed custam bem acima do mínimo do cupom (R$ 50).
  await addFirstProductToCart(page, options.coupon ? "/produtos?q=processador" : "/produtos");

  await page.goto("/carrinho");
  await page.locator('a[href="/checkout"]').click();
  await expect(page).toHaveURL(/\/checkout/);

  await fillCheckoutAddress(page);
  await page.locator('input[name="paymentMethod"][value="pix"]').check();
  if (options.coupon) {
    await page.getByRole("textbox", { name: "Código de diretiva" }).fill(options.coupon);
    await page.getByRole("button", { name: "Aplicar" }).click();
    await expect(page.getByText("Desconto", { exact: true })).toBeVisible();
  }
  await page.locator(`input[name="simulate"][value="${outcome}"]`).check();
  await page.getByRole("button", { name: "Confirmar aquisição" }).click();

  await expect(page).toHaveURL(/\/pedido\/DYS-/);
}

test.describe("checkout", () => {
  test("compra aprovada: a saga conclui e a página do pedido confirma", async ({ page }) => {
    await buy(page, "approve");
    // O pagamento é remoto (outro processo): a página começa "processando" e
    // se atualiza sozinha até a saga terminar.
    await expect(page.getByRole("heading", { name: "Aquisição registrada." })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Pago", { exact: true })).toBeVisible();
    // O andamento são os eventos do pedido, na língua do cliente — não os passos da saga.
    await expect(page.getByText("Pedido recebido")).toBeVisible();
    await expect(page.getByText("Pagamento aprovado")).toBeVisible();
    await expect(page.getByText("Reserva de estoque")).toHaveCount(0);
  });

  test("pagamento recusado: a saga desfaz tudo e o pedido aparece cancelado", async ({ page }) => {
    await buy(page, "decline");
    await expect(page.getByRole("heading", { name: "Aquisição não concluída." })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/foi desfeito/)).toBeVisible();
    // O motivo vem do evento de cancelamento.
    await expect(page.getByText(/recusado pela operadora/).first()).toBeVisible();
  });

  test("gateway instável: o retry passa pela fila e o pedido conclui", async ({ page }) => {
    await buy(page, "flaky_once");
    // A 1ª cobrança falha e volta pela fila de espera; o cliente só vê o
    // pedido pago (as tentativas ficam no painel de operação).
    await expect(page.getByRole("heading", { name: "Aquisição registrada." })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("Pagamento aprovado")).toBeVisible();
  });

  test("cupom aplicado no checkout entra no pedido", async ({ page }) => {
    await buy(page, "approve", { coupon: "BEMVINDO10" });
    await expect(page.getByRole("heading", { name: "Aquisição registrada." })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/desconto/i).first()).toBeVisible();
  });

  test("pedido de uma pessoa não abre para outra", async ({ page, browser }) => {
    await buy(page, "approve");
    const orderUrl = page.url();

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await signUp(otherPage);
    const response = await otherPage.goto(orderUrl);
    expect(response?.status()).toBe(404);
    await expect(otherPage.getByRole("heading", { name: "Registro inexistente" })).toBeVisible();
    await other.close();
  });
});

test.describe("rota do cron", () => {
  test("sem o segredo, ou com o errado, recusa", async ({ request }) => {
    expect((await request.get("/api/cron/fila")).status()).toBe(401);
    expect((await request.get("/api/cron/fila", { headers: { authorization: "Bearer chute" } })).status()).toBe(401);
  });
});

