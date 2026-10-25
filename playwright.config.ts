import { defineConfig, devices } from "@playwright/test";

/**
 * Testes de navegador (`npm run test:e2e`) contra a loja RODANDO, com workers
 * — por padrão a stack do docker-compose:
 *
 *   docker compose --profile app up -d --build
 *   docker compose --profile app run --rm migrate npm run db:seed
 *   npm run test:e2e
 *
 * `E2E_BASE_URL` aponta pra outro endereço (ex.: `npm run dev` + workers).
 * O checkout usa o modo demonstração, então o app precisa de
 * `ALLOW_CHECKOUT_SIMULATION=1` (o compose já liga).
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    locale: "pt-BR",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "celular", use: { ...devices["Pixel 7"] } },
  ],
});
