import { expect, test as base, type Page } from "@playwright/test";

/**
 * Todo teste falha se o navegador registrar erro: exceção de JavaScript,
 * `console.error` ou violação da CSP (que o Chrome reporta no console). É o
 * que garante que a CSP não quebrou nada que a pessoa não veria no teste.
 */
export const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(`exceção: ${error.message}`));
      page.on("console", (message) => {
        // 404 de recurso é o próprio teste de 404 pedindo — não é erro de página.
        if (message.type() !== "error" || /status of 404/.test(message.text())) return;
        if (isBlockedStripeTelemetry(message.text(), message.location().url)) return;
        errors.push(message.text());
      });
      await use(errors);
      expect(errors, "erros no navegador").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Domínio do Stripe que a REDE de quem roda o teste não alcança (o antifraude
 * dele, `m.stripe.com`, cai em lista de bloqueio de DNS e de adblock). Não é
 * erro da página nem da CSP — violação de CSP tem outra mensagem e continua
 * derrubando o teste.
 */
function isBlockedStripeTelemetry(text: string, url: string): boolean {
  if (!/net::ERR_(NAME_NOT_RESOLVED|BLOCKED_BY_CLIENT|CONNECTION_REFUSED)/.test(text)) return false;
  try {
    return /(^|\.)stripe\.(com|network)$/.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Conta nova e única por teste (os testes rodam em paralelo). */
export function newCustomer() {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { name: "Cliente E2E", email: `e2e-${id}@exemplo.dev`, password: "senha-e2e-segura" };
}

/** Cadastro de uma conta nova pela tela (termina logado, em /conta). */
export async function signUp(page: Page) {
  const customer = newCustomer();
  await page.goto("/cadastro");
  await page.locator('input[name="name"]').fill(customer.name);
  await page.locator('input[name="email"]').fill(customer.email);
  await page.locator('input[name="password"]').fill(customer.password);
  await page.getByRole("button", { name: "Abrir ficha" }).click();
  await expect(page).toHaveURL(/\/conta/);
  return customer;
}

/** Endereço novo no checkout (conta recém-criada não tem endereço salvo). */
export async function fillCheckoutAddress(page: Page) {
  await page.locator('input[name="zipCode"]').fill("60000000");
  await page.locator('input[name="street"]').fill("Rua do Teste");
  await page.locator('input[name="number"]').fill("42");
  await page.locator('input[name="neighborhood"]').fill("Centro");
  await page.locator('input[name="city"]').fill("Fortaleza");
  await page.locator('input[name="state"]').fill("CE");
}

/** Login pela tela. Padrão: o admin do seed (senha por E2E_ADMIN_PASSWORD). */
export async function logIn(page: Page, email = "admin@dystopia.dev", password = process.env.E2E_ADMIN_PASSWORD ?? "admin123") {
  await page.goto("/entrar");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Identificar-se" }).click();
}

/**
 * Um produto com estoque de uma listagem no carrinho; devolve o caminho dele.
 * Os testes rodam em paralelo e compram de verdade: o primeiro da lista pode
 * esgotar no meio (a loja responde "esgotado", corretamente), então tenta o
 * próximo. Quem depende de preço (cupom com mínimo) passa uma busca.
 *
 * A listagem mostra os mais novos primeiro, e numa stack reaproveitada a 1ª
 * página pode ser só de produtos criados por outros testes: aí segue para a
 * próxima página.
 */
export async function addFirstProductToCart(page: Page, listing = "/produtos"): Promise<string> {
  await page.goto(listing);
  for (let pageNumber = 1; pageNumber <= 5; pageNumber += 1) {
    const added = await addFromCurrentPage(page);
    if (added) return added;
    const next = page.locator('nav[aria-label="Paginação"] a[rel="next"]');
    if ((await next.count()) === 0) break;
    await page.goto((await next.getAttribute("href"))!);
  }
  throw new Error(`nenhum produto com estoque em ${listing}`);
}

async function addFromCurrentPage(page: Page): Promise<string | null> {
  const buttons = page.getByRole("button", { name: "Adicionar ao carrinho" });
  const total = await buttons.count();
  const hrefs: string[] = [];
  for (let i = 0; i < total; i += 1) {
    const href = await buttons
      .nth(i)
      .locator('xpath=ancestor::article[1]')
      .locator('a[href^="/produto/"]')
      .first()
      .getAttribute("href");
    // Produto criado por outro teste (slug com `-e2e-`) tem estoque pequeno e
    // vida curta: comprar dele faz um teste esgotar o produto do outro no meio
    // do checkout.
    if (href && !href.includes("-e2e-")) hrefs.push(href);
  }
  // O card fica preso ao link (estável): o botão muda de nome depois do clique,
  // e um localizador por "i-ésimo botão Adicionar" passaria a apontar para o próximo.
  for (const href of hrefs) {
    const card = page.locator("article").filter({ has: page.locator(`a[href="${href}"]`) }).first();
    await card.getByRole("button", { name: "Adicionar ao carrinho" }).click();
    const added = card.getByRole("button", { name: "Registrado no carrinho" });
    if (await added.waitFor({ timeout: 5_000 }).then(() => true, () => false)) return href;
  }
  return null;
}
