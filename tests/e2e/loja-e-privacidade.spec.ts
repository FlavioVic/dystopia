import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, signUp, test } from "./fixtures";

/**
 * Buracos do storefront público: navegação por categoria (a trilha do produto)
 * e as páginas que o axe ainda não cobria (categoria e créditos). Mais o
 * download de dados da conta (LGPD). Tudo por papel/rótulo, para sobreviver ao
 * redesenho em curso.
 */

/** Violações de acessibilidade que impedem o uso (serious/critical). */
async function blockingViolations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.length}× — ${v.nodes[0]?.target.join(" ")}`);
}

test.describe("categoria", () => {
  test.beforeEach(async ({ page }) => {
    // O axe mede contraste no instante da análise; sem o fade de entrada, o
    // elemento já está opaco.
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("trilha do produto leva à categoria, que lista itens e é acessível", async ({ page }) => {
    await page.goto("/produtos");
    await page.locator('a[href^="/produto/"]').first().click();
    await expect(page).toHaveURL(/\/produto\//);

    // A trilha é "Inventário / <Categoria> / <SKU>": o 2º link é a categoria.
    const trail = page.getByRole("navigation", { name: "Trilha" });
    const categoryLink = trail.getByRole("link").nth(1);
    const categoryName = (await categoryLink.textContent())?.trim() ?? "";
    expect(categoryName.length).toBeGreaterThan(0);
    await categoryLink.click();

    await expect(page).toHaveURL(/\/categoria\//);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(categoryName);
    // A categoria lista produtos navegáveis.
    await expect(page.locator('a[href^="/produto/"]').first()).toBeVisible();

    expect(await blockingViolations(page), "violações na categoria").toEqual([]);
  });

  test("página de créditos é acessível (axe)", async ({ page }) => {
    await page.goto("/creditos");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await blockingViolations(page), "violações em /creditos").toEqual([]);
  });
});

test.describe("privacidade da conta", () => {
  test("baixar meus dados: JSON da conta sem o hash da senha; anônimo é barrado", async ({ page, request }) => {
    // Sem sessão, o endpoint de exportação recusa (os dados saem do cookie, não da URL).
    const anon = await request.get("/conta/dados");
    expect(anon.status()).toBe(401);

    await signUp(page);
    // `page.request` herda os cookies do contexto logado.
    const res = await page.request.get("/conta/dados");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/json");
    expect(res.headers()["content-disposition"]).toContain("attachment");

    const body = await res.json();
    // Portabilidade LGPD: tem o que a loja guarda da pessoa...
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining(["conta", "enderecos", "pedidos", "avaliacoes", "favoritos"]),
    );
    // ...e NUNCA o hash da senha.
    expect(JSON.stringify(body).toLowerCase()).not.toContain("passwordhash");
    expect(JSON.stringify(body).toLowerCase()).not.toContain("password_hash");
  });
});
