import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { ADMIN_STATE } from "./admin-auth";
import { addFirstProductToCart, expect, signUp, test } from "./fixtures";

/**
 * Acessibilidade automática (axe, regras WCAG 2.1 A/AA) nas páginas públicas.
 * Falha em violação "serious" ou "critical" — as que impedem alguém de usar
 * a página com leitor de tela, teclado ou baixa visão.
 *
 * Com movimento reduzido: o axe mede contraste no instante da análise, e no
 * meio do fade de entrada o elemento ainda está semitransparente.
 */
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});
const PAGES = ["/", "/produtos", "/produtos?q=memoria", "/servicos", "/portfolio", "/sobre", "/privacidade", "/entrar", "/cadastro", "/carrinho", "/nao-existe"];

for (const path of PAGES) {
  test(`acessibilidade: ${path}`, async ({ page }) => {
    await page.goto(path);
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const blocking = violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.length}× — ${v.nodes[0]?.target.join(" ")}`);
    expect(blocking, `violações em ${path}`).toEqual([]);
  });
}

test("acessibilidade: página de produto", async ({ page }) => {
  await page.goto("/produtos");
  await page.locator('a[href^="/produto/"]').first().click();
  await expect(page).toHaveURL(/\/produto\//);
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.length}×`);
  expect(blocking).toEqual([]);
});

async function blockingViolations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${page.url()} ${v.id}: ${v.nodes.length}× — ${v.nodes[0]?.target.join(" ")}`);
}

test("acessibilidade: área do cliente e checkout", async ({ page }) => {
  await signUp(page);
  await addFirstProductToCart(page);
  const found: string[] = [];
  for (const path of ["/conta", "/conta/enderecos", "/conta/seguranca", "/favoritos", "/carrinho", "/checkout"]) {
    await page.goto(path);
    found.push(...(await blockingViolations(page)));
  }
  expect(found).toEqual([]);
});

test.describe(() => {
  test.use({ storageState: ADMIN_STATE });
  test("acessibilidade: painel admin", async ({ page }) => {
    const found: string[] = [];
    for (const path of ["/conta/seguranca", "/admin", "/admin/pedidos", "/admin/produtos", "/admin/produtos/novo", "/admin/cupons", "/admin/orcamentos", "/admin/orquestracao"]) {
      await page.goto(path);
      found.push(...(await blockingViolations(page)));
    }
    expect(found).toEqual([]);
  });
});
