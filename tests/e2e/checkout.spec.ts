import type { Page } from "@playwright/test";
import { expect, newCustomer, test } from "./fixtures";

/** Cadastro → um produto no carrinho → checkout com o resultado escolhido no modo demonstração. */
async function buy(page: Page, outcome: "approve" | "decline") {
  const customer = newCustomer();
  await page.goto("/cadastro");
  await page.locator('input[name="name"]').fill(customer.name);
  await page.locator('input[name="email"]').fill(customer.email);
  await page.locator('input[name="password"]').fill(customer.password);
  await page.getByRole("button", { name: "Abrir ficha" }).click();
  await expect(page).toHaveURL(/\/conta/);

  await page.goto("/produtos");
  await page.getByRole("button", { name: "Adicionar ao carrinho" }).first().click();
  await expect(page.getByRole("button", { name: "Registrado no carrinho" }).first()).toBeVisible();

  await page.goto("/carrinho");
  await page.locator('a[href="/checkout"]').click();
  await expect(page).toHaveURL(/\/checkout/);

  await page.locator('input[name="zipCode"]').fill("60000000");
  await page.locator('input[name="street"]').fill("Rua do Teste");
  await page.locator('input[name="number"]').fill("42");
  await page.locator('input[name="neighborhood"]').fill("Centro");
  await page.locator('input[name="city"]').fill("Fortaleza");
  await page.locator('input[name="state"]').fill("CE");
  await page.locator('input[name="paymentMethod"][value="pix"]').check();
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
  });

  test("pagamento recusado: a saga desfaz tudo e o pedido aparece cancelado", async ({ page }) => {
    await buy(page, "decline");
    await expect(page.getByRole("heading", { name: "Aquisição não concluída." })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/foi desfeito/)).toBeVisible();
  });
});
