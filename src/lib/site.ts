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
 * Conta demo do seed. E-mail e senha estão publicados em /sobre para quem
 * visita testar uma compra. Como qualquer pessoa entra nela, ela não segue a
 * regra das outras: fica fora do limite de login por conta
 * (`application/login.ts`), não troca de senha, não é excluída
 * (`application/account-privacy.ts`) e não publica avaliação
 * (`lib/actions/reviews.ts`) — o que ela escrevesse apareceria para todo mundo.
 */
export const DEMO_ACCOUNT_EMAIL = "cliente@dystopia.dev";

export const isDemoAccount = (email: string): boolean => email === DEMO_ACCOUNT_EMAIL;

/**
 * Quantos testes a suíte tem — aparece no projeto DYSTOPIA do portfólio. Escrito à mão, mas
 * `tests/unit/test-count.test.ts` conta os casos de verdade e falha se este
 * número ficar desatualizado.
 */
export const TEST_COUNT = 583;
