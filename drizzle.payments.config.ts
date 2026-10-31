import { defineConfig } from "drizzle-kit";
import "dotenv/config";

/**
 * Banco do serviço de pagamentos: schema e migrations próprios.
 * `npm run db:generate:payments` para gerar; `npm run db:migrate` aplica os dois bancos.
 */
export default defineConfig({
  schema: "./src/services/payments/schema.ts",
  out: "./drizzle-payments",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.PAYMENTS_DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
