import { addFirstProductToCart, expect, fillCheckoutAddress, signUp, test } from "./fixtures";

/**
 * Robustez do checkout: o caminho de compensação que faltava (gateway fora do
 * ar, que esgota as tentativas da fila e desfaz tudo) e as bordas do formulário
 * — carrinho vazio, endereço em branco e cupom inválido. Tudo por papel/rótulo
 * acessível, sem depender da aparência (o storefront está em redesenho).
 */

test.describe("checkout: compensação e bordas", () => {
  test("gateway fora do ar: a saga esgota as tentativas e cancela, sem cobrança", async ({ page }) => {
    await signUp(page);
    await addFirstProductToCart(page, "/produtos?q=processador");

    await page.goto("/checkout");
    await fillCheckoutAddress(page);
    await page.locator('input[name="paymentMethod"][value="pix"]').check();
    // "Gateway fora do ar": falha transitória a cada tentativa; a fila tenta de
    // novo com backoff e, esgotadas as tentativas, a saga compensa.
    await page.locator('input[name="simulate"][value="unavailable"]').check();
    await page.getByRole("button", { name: "Confirmar aquisição" }).click();

    await expect(page).toHaveURL(/\/pedido\/DYS-/);
    // O backoff soma alguns segundos antes do cancelamento (tentativas na fila de espera).
    await expect(page.getByRole("heading", { name: "Aquisição não concluída." })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/foi desfeito/)).toBeVisible();
    await expect(page.getByText("Nenhuma cobrança ficou em aberto.")).toBeVisible();
    // Nada foi debitado: a cobrança é o pivô e ela nunca aprovou.
    await expect(page.getByText("Nenhuma cobrança", { exact: true })).toBeVisible();
    await expect(page.getByText("Pago", { exact: true })).toHaveCount(0);
  });

  test("checkout de carrinho vazio volta para o carrinho", async ({ page }) => {
    // Conta nova não tem itens: o checkout não existe sem carrinho e redireciona.
    await signUp(page);
    await page.goto("/checkout");
    await expect(page).toHaveURL(/\/carrinho/);
    await expect(page.getByRole("heading", { name: "Nenhum item registrado." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Consultar inventário" })).toBeVisible();
  });

  test("endereço novo em branco barra o checkout com erro por campo", async ({ page }) => {
    await signUp(page);
    await addFirstProductToCart(page);

    await page.goto("/checkout");
    // Conta nova não tem endereço salvo: o formulário de endereço novo já aparece.
    // Confirma sem preencher nada (só o destinatário vem do nome da conta).
    await page.getByRole("button", { name: "Confirmar aquisição" }).click();

    // Continua no checkout, com o erro embaixo de cada campo obrigatório.
    await expect(page).toHaveURL(/\/checkout/);
    await expect(page.getByText("Informe a rua.")).toBeVisible();
    await expect(page.getByText("Informe o bairro.")).toBeVisible();
    await expect(page.getByText("Informe a cidade.")).toBeVisible();
    // Não criou pedido: nenhuma navegação para a página do pedido.
    await expect(page).not.toHaveURL(/\/pedido\//);
  });

  test("cupom inexistente é recusado e não entra no total", async ({ page }) => {
    await signUp(page);
    await addFirstProductToCart(page, "/produtos?q=processador");

    await page.goto("/checkout");
    await page.getByRole("textbox", { name: "Código de diretiva" }).fill("NAOEXISTE123");
    await page.getByRole("button", { name: "Aplicar" }).click();

    await expect(page.getByText("Cupom inválido ou inativo.")).toBeVisible();
    // Sem desconto no resumo: a linha "Desconto" só aparece com cupom válido.
    await expect(page.getByText("Desconto", { exact: true })).toHaveCount(0);
  });
});
