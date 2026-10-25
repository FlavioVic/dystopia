import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Painel do assistente no navegador. A resposta da API é interceptada: o que
 * se testa aqui é a TELA (abrir, mandar, mostrar link, erro, teclado,
 * acessibilidade), não o modelo — que é cobrado por cota e não responde igual
 * duas vezes. O caminho servidor → modelo → ferramentas tem testes de
 * integração próprios (tests/integration/assistant-*).
 *
 * O botão só existe com `CHAT_API_KEY` no app (o compose repassa a variável;
 * o CI liga com um valor qualquer). Sem ela, a suíte pula.
 */

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  test.skip((await page.getByRole("button", { name: "Assistente" }).count()) === 0, "assistente desligado neste app");
});

/** Responde o próximo POST /api/assistente com `reply` e guarda o que foi enviado. */
async function answerWith(page: Page, respond: (route: Route) => Promise<void>) {
  const sent: { messages: { role: string; content: string }[] }[] = [];
  await page.route("**/api/assistente", async (route) => {
    sent.push(route.request().postDataJSON());
    await respond(route);
  });
  return sent;
}

const reply = (text: string) => (route: Route) => route.fulfill({ json: { reply: text } });

async function openPanel(page: Page) {
  await page.getByRole("button", { name: "Assistente" }).click();
  const panel = page.getByRole("dialog", { name: "Assistente da loja" });
  await expect(panel).toBeVisible();
  return panel;
}

test("pergunta → resposta, com link interno navegável e externo como texto", async ({ page }) => {
  const sent = await answerWith(page, reply("Temos o [Ryzen 5](/produtos?q=ryzen). Não pague em [aqui](https://golpe.dev)."));
  const panel = await openPanel(page);

  await expect(panel.getByRole("textbox", { name: "Mensagem" })).toBeFocused();
  await panel.getByRole("textbox", { name: "Mensagem" }).fill("tem ryzen?");
  await panel.getByRole("button", { name: "Enviar" }).click();

  await expect(panel.getByRole("link", { name: "Ryzen 5" })).toBeVisible();
  await expect(panel.getByRole("link", { name: "aqui" })).toHaveCount(0);
  expect(sent[0].messages).toEqual([{ role: "user", content: "tem ryzen?" }]);

  // A conversa sobrevive à navegação: o painel mora no layout.
  await panel.getByRole("link", { name: "Ryzen 5" }).click();
  await expect(page).toHaveURL(/\/produtos\?q=ryzen/);
  await expect(panel.getByText("tem ryzen?")).toBeVisible();
});

test("sugestão manda a pergunta e o histórico vai junto na seguinte", async ({ page }) => {
  const sent = await answerWith(page, reply("Entendido."));
  const panel = await openPanel(page);

  await panel.getByRole("button", { name: "Quero orçar uma montagem" }).click();
  await expect(panel.getByText("Entendido.")).toBeVisible();
  await panel.getByRole("textbox", { name: "Mensagem" }).fill("é para jogos");
  await panel.getByRole("textbox", { name: "Mensagem" }).press("Enter");
  await expect(panel.getByText("Entendido.")).toHaveCount(2);

  expect(sent[1].messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
});

test("erro do servidor aparece como alerta e a pessoa pode tentar de novo", async ({ page, browserErrors }) => {
  await answerWith(page, (route) =>
    route.fulfill({ status: 503, json: { error: "Muitas perguntas ao mesmo tempo. Tente de novo em 12 s." } }),
  );
  const panel = await openPanel(page);
  await panel.getByRole("textbox", { name: "Mensagem" }).fill("oi");
  await panel.getByRole("button", { name: "Enviar" }).click();

  await expect(panel.getByRole("alert")).toHaveText(/Tente de novo em 12 s/);
  await expect(panel.getByRole("textbox", { name: "Mensagem" })).toBeEnabled();
  // O 503 é esperado aqui: o Chrome o registra no console, e a fixture contaria como erro.
  browserErrors.splice(0, browserErrors.length);
});

test("teclado: Escape fecha e devolve o foco ao botão", async ({ page }) => {
  const panel = await openPanel(page);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Assistente" })).toBeFocused();
});

test("acessibilidade do painel aberto, com conversa", async ({ page }) => {
  await answerWith(page, reply("Veja os [processadores](/produtos)."));
  const panel = await openPanel(page);
  await panel.getByRole("textbox", { name: "Mensagem" }).fill("processador");
  await panel.getByRole("button", { name: "Enviar" }).click();
  await expect(panel.getByRole("link", { name: "processadores" })).toBeVisible();

  const { violations } = await new AxeBuilder({ page })
    .include("#assistente")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.length}×`);
  expect(blocking).toEqual([]);
});
