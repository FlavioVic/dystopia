import { expect, logIn, test } from "./fixtures";

test.describe("painel admin", () => {
  test.beforeEach(async ({ page }) => {
    await logIn(page);
    await expect(page).toHaveURL(/\/conta/);
  });

  test("cria um produto e ele aparece na loja", async ({ page }) => {
    const id = Date.now().toString(36);
    await page.goto("/admin/produtos/novo");
    await page.locator('input[name="name"]').fill(`Pasta térmica E2E ${id}`);
    await page.locator('input[name="slug"]').fill(`pasta-termica-e2e-${id}`);
    await page.locator('input[name="sku"]').fill(`E2E-${id}`.toUpperCase());
    await page.locator('select[name="categoryId"]').selectOption({ index: 1 });
    await page.locator('input[name="price"]').fill("49.90");
    await page.locator('input[name="stock"]').fill("7");
    await page.locator('textarea[name="description"]').fill("Pasta térmica para teste automatizado.");
    await page.getByRole("button", { name: "Criar produto" }).click();
    await expect(page).not.toHaveURL(/\/novo/);

    await page.goto(`/produto/pasta-termica-e2e-${id}`);
    await expect(page.getByRole("heading", { name: `Pasta térmica E2E ${id}` })).toBeVisible();
  });

  test("cria um cupom", async ({ page }) => {
    const code = `E2E${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
    await page.goto("/admin/cupons/novo");
    await page.locator('input[name="code"]').fill(code);
    await page.locator('input[name="discountValue"]').fill("15");
    await page.getByRole("button", { name: "Criar cupom" }).click();
    await expect(page).toHaveURL(/\/admin\/cupons$/);
    await expect(page.getByText(code)).toBeVisible();
  });

  test("painel de orquestração mostra as filas do RabbitMQ", async ({ page }) => {
    await page.goto("/admin/orquestracao");
    await expect(page.getByText("Fila · RabbitMQ")).toBeVisible();
    for (const queue of ["saga", "payments", "notifications"]) {
      await expect(page.getByRole("cell", { name: queue, exact: true })).toBeVisible();
    }
    await expect(page.getByText("RabbitMQ inacessível")).toHaveCount(0);
  });
});
