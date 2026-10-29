/**
 * URL pública do site, para metadados absolutos (sitemap, robots, Open Graph).
 * Na Vercel vem da variável de sistema do domínio de produção; SITE_URL
 * sobrescreve (domínio próprio); em dev, localhost.
 */
export const SITE_URL = (
  process.env.SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : `http://localhost:${process.env.PORT ?? 3000}`)
).replace(/\/$/, "");

/**
 * Contato público da loja — caixa própria do projeto, não um e-mail pessoal
 * (o repositório é público). É também a caixa que recebe os e-mails do site
 * no modo sandbox do Resend e o aviso de cada orçamento.
 */
export const CONTACT_EMAIL = "contato.dystopia23@gmail.com";

/**
 * Quantos testes a suíte tem — aparece na home. Escrito à mão, mas
 * `tests/unit/test-count.test.ts` conta os casos de verdade e falha se este
 * número ficar desatualizado.
 */
export const TEST_COUNT = 418;
