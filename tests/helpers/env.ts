import "dotenv/config";

/**
 * URL do banco de TESTE. Derivada do `DATABASE_URL` de dev trocando o nome do
 * banco por `<nome>_test`, então o mesmo Postgres serve os dois e nenhum teste
 * encosta nos dados de desenvolvimento. Dá para sobrescrever com
 * `TEST_DATABASE_URL`.
 */
export function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;

  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error("Defina DATABASE_URL (ou TEST_DATABASE_URL) para rodar os testes.");
  }

  const url = new URL(base);
  const name = url.pathname.replace(/^\//, "") || "postgres";
  if (name.endsWith("_test")) return url.toString();
  url.pathname = `/${name}_test`;
  return url.toString();
}

/** URL administrativa (banco `postgres`) para poder criar o banco de teste. */
export function adminDatabaseUrl(): string {
  const url = new URL(testDatabaseUrl());
  url.pathname = "/postgres";
  return url.toString();
}

export function testDatabaseName(): string {
  return new URL(testDatabaseUrl()).pathname.replace(/^\//, "");
}
