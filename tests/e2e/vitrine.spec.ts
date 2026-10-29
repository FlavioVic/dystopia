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

  test("sobre fala da loja: o que vende, compromissos e quem atende", async ({ page }) => {
    await page.goto("/sobre");
    await expect(page).toHaveTitle(/Sobre a loja/);
    for (const heading of ["O que a loja faz", "Como o atendimento funciona", "Compromissos da loja", "Quem atende", "Loja de demonstração"]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
    await expect(page.getByText("Em compras a partir de R$ 149,90.", { exact: false })).toBeVisible();
    await expect(page.getByText("Por baixo do capô")).toHaveCount(0);
  });

  test("cupons em vigor aparecem logo abaixo do botão de comprar", async ({ page }) => {
    await page.goto("/produtos");
    await page.locator('a[href^="/produto/"]').first().click();
    await expect(page).toHaveURL(/\/produto\//);
    const coupons = page.getByRole("heading", { name: /Cupons em vigor/ });
    await expect(coupons).toBeVisible();
    // Antes das avaliações e da ficha técnica, na coluna da compra.
    const [buy, couponsBox, reviews] = await Promise.all([
      page.getByRole("button", { name: /Adicionar ao carrinho|Sem estoque/ }).first().boundingBox(),
      coupons.boundingBox(),
      page.getByRole("heading", { name: "Relatórios de campo" }).boundingBox(),
    ]);
    expect(couponsBox!.y).toBeGreaterThan(buy!.y);
    expect(couponsBox!.y).toBeLessThan(reviews!.y);
  });
});
