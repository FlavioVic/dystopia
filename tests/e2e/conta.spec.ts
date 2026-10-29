import { addFirstProductToCart, expect, logIn, signUp, test } from "./fixtures";

test.describe("acesso", () => {
  test("login do cliente do seed, senha errada e saída", async ({ page }) => {
    await logIn(page, "cliente@dystopia.dev", "senha-errada");
    await expect(page.getByText("E-mail ou senha inválidos.")).toBeVisible();

    await logIn(page, "cliente@dystopia.dev", "cliente123");
    await expect(page).toHaveURL(/\/conta/);
    await page.getByRole("button", { name: "Encerrar sessão" }).click();
    await expect(page).toHaveURL(/\/entrar/);
  });

  test("anônimo não entra na conta; cliente não entra no admin", async ({ page }) => {
    await page.goto("/conta");
    await expect(page).toHaveURL(/\/entrar/);

    // Cliente logado: o admin manda para /entrar, que manda quem já tem sessão
    // para /conta. O que importa é não ficar no admin.
    await signUp(page);
    await page.goto("/admin");
    await expect(page).not.toHaveURL(/\/admin/);
    await expect(page.getByRole("heading", { name: "Comando" })).toHaveCount(0);
  });

  test("título do login e do cadastro cabe numa linha (não quebra no meio da palavra)", async ({ page }) => {
    for (const width of [320, 375, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      for (const path of ["/entrar", "/cadastro"]) {
        await page.goto(path);
        // Mede com a Michroma carregada: com a fonte reserva a largura é outra.
        await page.evaluate(() => document.fonts.ready);
        const lines = await page.getByRole("heading", { level: 1 }).evaluate((el) =>
          Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)),
        );
        expect(lines, `${path} em ${width}px`).toBe(1);
      }
    }
  });

  test("sair derruba o login de verdade: o cookie copiado antes não vale mais", async ({ page, browser }) => {
    await signUp(page);
    const copied = await page.context().cookies();

    await page.getByRole("button", { name: "Encerrar sessão" }).click();
    await expect(page).toHaveURL(/\/entrar/);

    const elsewhere = await browser.newContext();
    await elsewhere.addCookies(copied);
    const stolen = await elsewhere.newPage();
    await stolen.goto("/conta");
    await expect(stolen).toHaveURL(/\/entrar/);
    await elsewhere.close();
  });

  test("sair dos outros aparelhos: o outro navegador cai, este continua", async ({ page, browser }) => {
    const customer = await signUp(page);
    const otherDevice = await browser.newContext();
    const phone = await otherDevice.newPage();
    await logIn(phone, customer.email, customer.password);
    await expect(phone).toHaveURL(/\/conta/);

    await page.goto("/conta/seguranca");
    await expect(page.getByText("2 sessões abertas, contando esta.")).toBeVisible();
    await page.getByRole("button", { name: "Sair dos outros aparelhos" }).click();
    await expect(page.getByText("1 sessão encerrada.")).toBeVisible();

    await phone.goto("/conta");
    await expect(phone).toHaveURL(/\/entrar/);
    await page.goto("/conta");
    await expect(page.getByRole("heading", { name: customer.name })).toBeVisible();
    await otherDevice.close();
  });

  test("cliente não vê o cadastro de autenticador (só o painel exige)", async ({ page }) => {
    await signUp(page);
    await page.goto("/conta/seguranca");
    await expect(page.getByRole("button", { name: "Sair dos outros aparelhos" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Configurar autenticador" })).toHaveCount(0);
  });

  test("cadastro com e-mail já usado avisa no campo", async ({ page }) => {
    await page.goto("/cadastro");
    await page.locator('input[name="name"]').fill("Outra Pessoa");
    await page.locator('input[name="email"]').fill("cliente@dystopia.dev");
    await page.locator('input[name="password"]').fill("senha-qualquer-1");
    await page.getByRole("button", { name: "Abrir ficha" }).click();
    await expect(page.getByText("Já existe uma conta com esse e-mail.")).toBeVisible();
  });
});

test.describe("carrinho", () => {
  test("aumentar, diminuir e remover item", async ({ page }) => {
    await addFirstProductToCart(page);
    await page.goto("/carrinho");

    await page.getByRole("button", { name: "Aumentar quantidade" }).first().click();
    await expect(page.getByRole("link", { name: /Carrinho \(2 itens\)/ })).toBeVisible();
    await page.getByRole("button", { name: "Diminuir quantidade" }).first().click();
    await expect(page.getByRole("link", { name: /Carrinho \(1 item\)/ })).toBeVisible();

    await page.getByRole("button", { name: "Remover" }).first().click();
    await expect(page.getByRole("heading", { name: "Nenhum item registrado." })).toBeVisible();
  });
});

test.describe("conta do cliente", () => {
  test("endereço salvo aparece na agenda", async ({ page }) => {
    await signUp(page);
    await page.goto("/conta/enderecos");
    await page.locator('input[name="label"]').fill("Casa");
    await page.locator('input[name="recipientName"]').fill("Cliente E2E");
    await page.locator('input[name="zipCode"]').fill("01310100");
    await page.locator('input[name="street"]').fill("Avenida Paulista");
    await page.locator('input[name="number"]').fill("1000");
    await page.locator('input[name="neighborhood"]').fill("Bela Vista");
    await page.locator('input[name="city"]').fill("São Paulo");
    await page.locator('input[name="state"]').fill("SP");
    await page.getByRole("button", { name: "Salvar endereço" }).click();
    await expect(page.getByText(/Avenida Paulista, 1000/)).toBeVisible();
  });

  test("favoritar e avaliar um produto", async ({ page }) => {
    await signUp(page);
    const productPath = await addFirstProductToCart(page);
    await page.goto(productPath);

    await page.getByRole("button", { name: "Adicionar aos favoritos" }).first().click();
    await expect(page.getByRole("button", { name: "Remover dos favoritos" }).first()).toBeVisible();

    // Título único: o produto do catálogo acumula avaliações de outras rodadas e
    // do outro tamanho de tela (rodam juntos).
    const title = `Cumpre o que promete ${Date.now().toString(36)}`;
    await page.getByRole("button", { name: "4 estrelas" }).click();
    await page.locator('input[name="title"]').fill(title);
    await page.locator('textarea[name="comment"]').fill("Montado e testado, sem surpresa.");
    await page.getByRole("button", { name: "Publicar avaliação" }).click();
    await expect(page.getByText(title)).toBeVisible();

    await page.goto("/favoritos");
    await expect(page.locator(`a[href="${productPath}"]`).first()).toBeVisible();
  });
});

test.describe("serviços", () => {
  test("pedido de orçamento devolve o protocolo", async ({ page }) => {
    await page.goto("/servicos");
    // O rádio é visualmente oculto: quem clica é o rótulo estilizado.
    await page.locator('label:has(input[name="kind"])').first().click();
    await page.locator('input[name="name"]').fill("Cliente E2E");
    await page.locator('input[name="email"]').fill("orcamento-e2e@exemplo.dev");
    await page.locator('textarea[name="details"]').fill("Computador desligando sozinho depois de meia hora de uso.");
    await page.getByRole("button", { name: "Registrar solicitação" }).click();
    await expect(page.getByText(/^DYS-S\d{6}$/)).toBeVisible();
  });
});
