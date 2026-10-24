import { expect, test as base } from "@playwright/test";

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
        if (message.type() === "error" && !/status of 404/.test(message.text())) errors.push(message.text());
      });
      await use(errors);
      expect(errors, "erros no navegador").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Conta nova e única por teste (os testes rodam em paralelo). */
export function newCustomer() {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { name: "Cliente E2E", email: `e2e-${id}@exemplo.dev`, password: "senha-e2e-segura" };
}
