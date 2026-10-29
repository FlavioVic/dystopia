import { expect, test } from "./fixtures";

test.describe("vitrine", () => {
  test("home carrega com a marca e o chamado para orçamento", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/DYSTOPIA/i);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/A ordem é um/i);
    await expect(page.getByRole("main").getByRole("link", { name: "Solicitar orçamento" }).first()).toBeVisible();
  });

  test("busca sem acento acha o produto com acento", async ({ page }) => {
    await page.goto("/produtos?q=memoria");
    await expect(page.getByRole("heading", { name: "Resultado da consulta" })).toBeVisible();
    const cards = page.locator('a[href^="/produto/"]');
    await expect(cards.first()).toBeVisible();
    for (const name of await cards.allInnerTexts()) {
      if (name.trim()) expect(name.toLowerCase()).toContain("memória");
    }
  });

  test("inventário paginado: próxima página e volta", async ({ page }) => {
    await page.goto("/produtos");
    const nav = page.getByRole("navigation", { name: "Paginação" });
    await expect(nav.locator('[aria-current="page"]')).toHaveText("01");
    await nav.getByRole("link", { name: "Próxima" }).click();
    await expect(page).toHaveURL(/pagina=2/);
    await expect(nav.locator('[aria-current="page"]')).toHaveText("02");
    await nav.getByRole("link", { name: "Anterior" }).click();
    await expect(page).toHaveURL(/\/produtos$/);
  });

  test("endereço inexistente: 404 com a página da marca", async ({ page }) => {
    const response = await page.goto("/produto/nao-existe");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Registro inexistente" })).toBeVisible();
  });
});
