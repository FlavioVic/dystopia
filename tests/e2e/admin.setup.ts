import { ADMIN_STATE, currentCode, loadAdminSecret, saveAdminSecret, waitNextStep } from "./admin-auth";
import { expect, logIn, test as setup } from "./fixtures";

/**
 * Login do admin com segundo fator, uma vez por rodada (os outros projetos
 * dependem deste). No caminho, prova o que importa: senha sozinha não abre o
 * painel, o cadastro do autenticador funciona pela tela e o código de
 * recuperação entra no lugar do celular.
 */
setup("admin: senha + autenticador", async ({ page }) => {
  setup.setTimeout(120_000);
  await logIn(page);
  await page.waitForURL(/\/conta\/seguranca|\/entrar\/verificacao/);

  if (page.url().includes("/conta/seguranca")) {
    // Stack recém-semeada: admin sem autenticador entra como cliente e não abre o painel.
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/conta\/seguranca/);

    await page.getByRole("button", { name: "Configurar autenticador" }).click();
    const manualKey = (await page.getByTestId("mfa-manual-key").textContent()) ?? "";
    saveAdminSecret(manualKey);
    await page.getByLabel("Código de 6 dígitos").fill(currentCode(loadAdminSecret()));
    await page.getByRole("button", { name: "Ativar" }).click();
    const codes = page.getByRole("list", { name: "Códigos de recuperação" }).getByRole("listitem");
    await expect(codes).toHaveCount(10);
    const recoveryCode = (await codes.first().textContent()) ?? "";

    // Sai e entra de novo com um código de recuperação (o celular "sumiu").
    await page.goto("/conta");
    await page.getByRole("button", { name: "Encerrar sessão" }).click();
    await logIn(page);
    await expect(page).toHaveURL(/\/entrar\/verificacao/);
    await page.getByLabel("Código do autenticador").fill(recoveryCode);
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page).toHaveURL(/\/conta\/seguranca\?recuperacao=1/);
    await expect(page.getByText("9 restantes")).toBeVisible();
  } else {
    // Senha certa, código ainda não: não é login.
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/entrar$/);
    await page.goto("/entrar/verificacao");

    const secret = loadAdminSecret();
    const submitCode = async () => {
      await page.getByLabel("Código do autenticador").fill(currentCode(secret));
      await page.getByRole("button", { name: "Confirmar" }).click();
    };
    await submitCode();
    // Rodada anterior colada nesta pode ter usado o código desta janela de 30 s.
    if (!(await page.waitForURL(/\/admin$/, { timeout: 5_000 }).then(() => true, () => false))) {
      await expect(page.getByText("Código inválido ou já usado.")).toBeVisible();
      await waitNextStep();
      await submitCode();
    }
    await expect(page).toHaveURL(/\/admin$/);
  }

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Comando" })).toBeVisible();
  await page.context().storageState({ path: ADMIN_STATE });
});
