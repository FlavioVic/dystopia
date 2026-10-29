import { ADMIN_STATE } from "./admin-auth";
import { expect, test } from "./fixtures";
import { solidPng } from "./png";

test.describe("painel admin", () => {
  // Sessão do admin já com segundo fator (feita pelo `admin.setup.ts`).
  test.use({ storageState: ADMIN_STATE });

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

  test("produto com poucas unidades: o selo vai junto do preço e não cobre o Salvar no celular", async ({ page }) => {
    const id = Date.now().toString(36);
    const name = `Cabo SATA E2E ${id}`;
    await page.goto("/admin/produtos/novo");
    await page.locator('input[name="name"]').fill(name);
    await page.locator('input[name="slug"]').fill(`cabo-sata-e2e-${id}`);
    await page.locator('input[name="sku"]').fill(`SATA-${id}`.toUpperCase());
    await page.locator('select[name="categoryId"]').selectOption({ index: 1 });
    await page.locator('input[name="price"]').fill("19.90");
    await page.locator('input[name="stock"]').fill("2");
    await page.locator('textarea[name="description"]').fill("Cabo para teste do selo de estoque baixo.");
    await page.getByRole("button", { name: "Criar produto" }).click();
    await expect(page).not.toHaveURL(/\/novo/);

    // Celular estreito: o card tem ~144px, o pior caso.
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/produtos?q=${encodeURIComponent(name)}`);
    const card = page.locator("article").filter({ hasText: name });
    const stock = card.getByText("Últimas 02");
    const save = card.getByRole("button", { name: /favoritos/i });
    await expect(stock).toBeVisible();
    const [a, b] = await Promise.all([stock.boundingBox(), save.boundingBox()]);
    const overlap = a && b && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    expect(overlap, "selo de estoque por cima do Salvar").toBeFalsy();
  });

  test("galeria: envia fotos, escolhe a principal e o cliente vê todas, inclusive em tela cheia", async ({ page }) => {
    // Desktop e celular rodam juntos: só o relógio repetiria o slug.
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const name = `Ventoinha E2E ${id}`;
    await page.goto("/admin/produtos/novo");
    await page.locator('input[name="name"]').fill(name);
    await page.locator('input[name="slug"]').fill(`ventoinha-e2e-${id}`);
    await page.locator('input[name="sku"]').fill(`FAN-${id}`.toUpperCase());
    await page.locator('select[name="categoryId"]').selectOption({ index: 1 });
    await page.locator('input[name="price"]').fill("89.90");
    await page.locator('input[name="stock"]').fill("9");
    await page.locator('textarea[name="description"]').fill("Ventoinha para teste da galeria.");
    await page.getByRole("button", { name: "Criar produto" }).click();
    // Depois de criar, a edição — é lá que ficam as fotos.
    await expect(page).toHaveURL(/\/admin\/produtos\/[0-9a-f-]{36}$/);

    for (const [side, color] of [["frente", [200, 30, 50]], ["lado", [30, 60, 200]]] as const) {
      await page.locator("#image-file").setInputFiles({ name: `${side}.png`, mimeType: "image/png", buffer: solidPng(64, 64, color) });
      await page.locator("#image-alt").fill(`${name} de ${side}`);
      await page.getByRole("button", { name: "Enviar imagem" }).click();
      await expect(page.getByRole("img", { name: `${name} de ${side}` })).toBeVisible();
    }
    await expect(page.getByText("Imagens (2/10)")).toBeVisible();

    // Arquivo que não é imagem (texto com nome .png) é recusado pelo conteúdo.
    await page.locator("#image-file").setInputFiles({ name: "falso.png", mimeType: "image/png", buffer: Buffer.from("<svg><script>alert(1)</script></svg>") });
    await page.getByRole("button", { name: "Enviar imagem" }).click();
    await expect(page.getByText("Formato não aceito. Envie JPEG, PNG, WebP ou AVIF.")).toBeVisible();

    await page.getByRole("button", { name: "Tornar principal" }).click();
    await expect(page.getByText("Principal", { exact: true }).locator("xpath=ancestor::li[1]").getByRole("img")).toHaveAttribute("alt", `${name} de lado`);

    await page.goto(`/produto/ventoinha-e2e-${id}`);
    await expect(page.getByText("01 / 02", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: `${name} de lado` }).first()).toBeVisible();
    await page.getByRole("button", { name: "Próxima imagem" }).first().click();
    await expect(page.getByText("02 / 02", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /Ampliar imagem/ }).click();
    const viewer = page.getByRole("dialog");
    await expect(viewer).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(viewer.getByText(/^01 \/ 02 ·/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
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
