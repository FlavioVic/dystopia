import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { base32Decode, totp, totpStep } from "../../src/services/mfa/totp";

/**
 * O "celular" do admin nos testes de navegador. O setup (`admin.setup.ts`)
 * cadastra o autenticador pela tela numa stack recém-semeada e guarda o
 * segredo aqui; nas rodadas seguintes, gera o código com ele. A sessão pronta
 * vai para `ADMIN_STATE`, que os testes do painel reaproveitam — um login só
 * por rodada, porque cada código vale uma vez.
 */

// O Playwright compila os testes como CommonJS: `__dirname`, não `import.meta`.
const AUTH_DIR = path.resolve(__dirname, "../../playwright/.auth");
export const ADMIN_STATE = path.join(AUTH_DIR, "admin.json");
const SECRET_FILE = path.join(AUTH_DIR, "admin-totp.txt");

export function saveAdminSecret(manualKey: string): void {
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(SECRET_FILE, manualKey.replace(/\s/g, ""));
}

export function loadAdminSecret(): Buffer {
  try {
    return base32Decode(readFileSync(SECRET_FILE, "utf-8"));
  } catch {
    throw new Error(
      "O admin já tem autenticador, mas o segredo não está em playwright/.auth. Rode o seed de novo " +
        "(docker compose --profile app run --rm migrate npm run db:seed) e o setup cadastra outro.",
    );
  }
}

export function currentCode(secret: Buffer): string {
  return totp(secret);
}

/** Espera virar o passo de 30 s (o código anterior já foi usado nesta janela). */
export async function waitNextStep(): Promise<void> {
  const step = totpStep(new Date());
  while (totpStep(new Date()) === step) await new Promise((resolve) => setTimeout(resolve, 250));
}
