# Segurança

Revisão de ponta a ponta feita em novembro de 2026: o que foi olhado, o que
estava bom, o que foi corrigido e o que ficou de fora de propósito. Serve
para quem revisa o projeto e para a próxima revisão saber de onde partir.

## Como foi feita

- **Referências:** OWASP Top 10 2025, OWASP ASVS 5.0, NIST SP 800-63B
  (senhas) e os cheat sheets da OWASP de sessão, senha e recuperação.
- **Falhas conhecidas da stack:** os avisos de segurança do Next.js e do
  React de 2026 (o pacote de outubro tem dois RCE críticos), mais `npm audit`.
- **Código:** cada porta de entrada lida uma por uma: as 41 Server Actions
  (toda função exportada de um arquivo `"use server"` é endpoint público), as
  3 rotas de API, o `proxy.ts`, sessão e MFA, upload de foto, assistente,
  otimizador de imagem, e-mails, SQL, logs, Dockerfiles, workflows e as
  configurações do repositório.
- **Produção:** os achados de borda foram testados contra o site no ar
  (com requisição comum, nada destrutivo).

## Achados e correções

| # | Gravidade | Achado | Correção |
|---|---|---|---|
| 1 | Alta | Repositório público com secret scanning, push protection, alertas do Dependabot e CodeQL desligados; o Dependabot só olhava as actions | Tudo ligado; Dependabot também para npm (raiz e `infra/`) e Docker |
| 2 | Alta | A conta demo (senha publicada em `/sobre`) podia ser excluída por qualquer visitante, e publicar avaliação em nome da loja | Exclusão e avaliação recusadas para ela; checkout e agenda dela avisam para não usar dado real |
| 3 | Alta | "Baixar meus dados" e "excluir conta" puxavam orçamentos mandados **sem login** com o mesmo e-mail. Como o cadastro não confirma o e-mail, quem criasse conta com o e-mail de outra pessoa lia ou apagava o que ela mandou | O vínculo é só pela conta (`userId`) |
| 4 | Média | Limite por IP furável com IPv6: um cliente tem um bloco /64 inteiro (2^64 endereços) e ganharia um contador novo a cada endereço | IPv6 conta pelo bloco /64 (`lib/request-ip.ts`) |
| 5 | Média | O otimizador de imagem aceitava `*.public.blob.vercel-storage.com`, o Blob de **qualquer** conta da Vercel (proxy de imagem alheia na nossa cota), e tinha SVG liberado | Só o store da loja (`lib/blob-host.ts`); `dangerouslyAllowSVG` desligado (as placas `.svg` já saíam direto) |
| 6 | Média | Senha sem teto de 72 bytes (o bcrypt ignora o resto: duas senhas longas com o mesmo começo valiam igual) e sem checagem de senha vazada | Teto de 72 bytes na senha nova; checagem no Pwned Passwords (abaixo) |
| 7 | Baixa | O token da sessão não mudava ao concluir o código do MFA | Token novo na conclusão (OWASP: novo token a cada mudança de privilégio) |
| 8 | Baixa | Cookie do carrinho sem `Secure`; agenda de endereços sem teto | `Secure` em produção; teto de 20 endereços, com mensagem no checkout |
| 9 | Baixa | Log sem máscara para campo sensível; sem `Cross-Origin-Opener-Policy` | Campo com nome de segredo sai `[omitido]`; COOP `same-origin` |
| 10 | Higiene | Next 16.4.3 e React 19.2.8 | Next 16.4.4 e React 19.2.9 |

Sobre o item 10: o RCE de outubro nos Server Components
([GHSA-xqc2-xf4c-x3h3](https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3),
CVSS 9.5) **não atingia o site**. No App Router o Next usa a própria cópia do
React (`next/dist/compiled`), corrigida desde a 16.4.1, e a falha só é
alcançável com Cache Components (`use cache`), que o projeto não usa.

### Senha vazada (Pwned Passwords)

Senha nova (cadastro e redefinição) é conferida no
[Pwned Passwords](https://haveibeenpwned.com/Passwords), do Have I Been Pwned,
com mais de 900 milhões de senhas de vazamentos. É o que o NIST pede
(800-63B, 3.1.1.2) e o que GitHub, 1Password e Okta usam.

- **k-anonimato:** a senha nunca sai do servidor, nem o hash inteiro. Só os 5
  primeiros caracteres do SHA-1 vão para a API, que devolve todos os sufixos
  que começam com eles; a comparação acontece aqui. O cabeçalho `Add-Padding`
  mistura respostas falsas para o tamanho da resposta também não entregar
  nada.
- **Se a API cair, a senha passa** e o log avisa: o cadastro não depende de
  um serviço de fora estar de pé.
- **Só depois de um filtro:** limite por IP no cadastro, link válido na
  redefinição. Sem isso, o site viraria proxy de consulta em massa.
- Código: `services/accounts/pwned-passwords.ts` e
  `application/password-policy.ts`. Consta na política de privacidade como
  operador.

## O que já estava bom

Mapa contra o OWASP Top 10 2025, para quem revisa:

- **A01 — Controle de acesso.** Toda action do painel começa com
  `ensureAdmin()` (papel admin **e** autenticador), e o teste de arquitetura
  exige isso. Toda página do `/admin` chama `requireAdmin()` por conta própria,
  não só o layout (layout não roda de novo na navegação do App Router). Dado
  de cliente é sempre filtrado pelo usuário da sessão ou pelo cookie do
  carrinho, e um pedido de outra pessoa dá 404. O assistente tira a identidade
  do cookie, nunca do corpo.
- **A02 — Configuração.** CSP com nonce por request e `strict-dynamic`,
  HSTS, `frame-ancestors 'none'`, `nosniff`, sem `X-Powered-By`. A rota do
  cron fica fechada sem o segredo e compara em tempo constante.
- **A03 — Cadeia de dependências.** Actions de terceiros presas pelo hash do
  commit; containers sem root (`USER node`).
- **A04 — Criptografia.** bcrypt na senha; segredo do autenticador cifrado
  com AES-256-GCM; token de sessão, de redefinição e de aparelho guardados só
  como SHA-256.
- **A05 — Injeção.** Todo SQL passa pelo Drizzle com parâmetro (os `sql\`\``
  interpolam valor, não texto). JSON-LD escapa `<`; e-mail escapa HTML.
- **A07 — Autenticação.** Sessão no banco (sair derruba na hora), MFA com
  proteção contra reúso do código, limite por IP e por conta com aparelho
  conhecido, hash falso para e-mail inexistente (o tempo não revela a conta),
  recuperação de senha no desenho da OWASP.
- **A08 — Integridade.** Upload de foto decidido pelos bytes, sem SVG, com
  teto de tamanho; chave do arquivo validada contra `..`.
- **A09 — Log e alerta.** Log estruturado, alerta de outbox parada e de saga
  travada no painel.
- **A10 — Condição excepcional.** Erro de regra vira mensagem; erro inesperado
  mostra só o digest. O limitador é um UPSERT atômico (sem corrida entre
  tentativas simultâneas).

## Riscos aceitos

Ficaram de fora de propósito, com o porquê:

- **Cadastro sem confirmar o e-mail.** O Resend está em sandbox (sem domínio
  próprio, todo e-mail vai para a caixa da loja), então um e-mail de
  confirmação não chegaria a ninguém. O que dependia do e-mail ser da pessoa
  (item 3) deixou de depender. Com domínio, o próximo passo é confirmar.
- **O cadastro diz se o e-mail já tem conta.** É a troca comum (avisar quem
  esqueceu que já tem conta); o limite por IP, agora por /64 no IPv6, segura a
  varredura.
- **A conta demo é compartilhada.** É o que deixa o visitante testar uma
  compra sem cadastro. O que ela publicaria foi fechado; endereço e pedido
  continuam visíveis para o próximo visitante, com aviso na tela.
- **`style-src 'unsafe-inline'` na CSP.** Há atributo `style` no React, que
  nonce não cobre. Script, que é o que importa, só roda com nonce.
- **Argumento das actions do painel sem checagem de tipo.** O TypeScript não
  vale em tempo de execução, mas só um admin com autenticador chega lá, e o
  efeito de um valor estranho é inofensivo (o serviço só grava o que conhece).
- **2 alertas moderados do Dependabot em ferramenta, não no site.** Os dois
  são dependência de desenvolvimento e não vão para o site.
  `esbuild` 0.18 (o servidor de desenvolvimento dele responde a pedido de
  qualquer site) vem do drizzle-kit, por um pacote antigo (`@esbuild-kit`),
  e o `esbuild serve` não é usado. `minimatch` 10 (DoS com padrão de glob
  feito para isso) vem do eslint 10 e do typescript-eslint, e os padrões
  que ele lê são os nossos, da configuração do lint. A correção é a
  versão 11, que os dois ainda não aceitam (pedem `^10`): forçar arrisca
  quebrar o lint. Ficam abertos de propósito, para o Dependabot avisar
  quando o drizzle-kit e o eslint trouxerem a versão corrigida. Na
  `infra/`, o Pulumi 3.274 (#59) tirou o `glob` e o `minimatch` vulneráveis.
- **Padrões genéricos e checagem de validade do secret scanning.** São do
  plano pago do GitHub. Os padrões dos provedores (Stripe, Resend, AWS...)
  e a push protection estão ligados.

## Primeira análise do CodeQL

A primeira rodada (conjunto `security-extended`, na `main`) levantou 6
alertas. Nenhum era falha explorável:

- **`js/path-injection` (2) em `lib/media-storage.ts`:** a chave do arquivo
  já passava por `safeMediaKey` (só `[a-z0-9_-]`, sem `..`) e o id do produto
  por UUID, mas o CodeQL não enxerga a validação dentro de outra função.
  Ganhou a segunda trava no padrão que ele reconhece: o caminho resolvido tem
  que continuar dentro da pasta.
- **`js/insecure-temporary-file` (1), mesmo arquivo:** o `docker-compose.yml`
  grava as fotos em `/tmp/dystopia-uploads`, mas isso é dentro do container,
  sem outro usuário para plantar um link. Na Vercel as fotos vão para o Blob.
- **`js/insufficient-password-hash` (2):** SHA-256 de token aleatório de 256
  bits (link de redefinição) e de chave do limite de tentativas, não de
  senha. Para token de alta entropia, hash rápido é o certo; senha usa
  bcrypt. Descartados como falso positivo, com o motivo no alerta.
- **`js/incomplete-url-substring-sanitization` (1):** um `.includes()` num
  array dentro de teste. Descartado como "usado em teste".

## Como manter

- **Dependências:** o "Dependabot security updates" abre PR na hora em que
  sai um alerta; o resto chega agrupado toda segunda. A versão principal do
  Node não vem por ele: é uma só em todo lugar (o `engines` do
  `package.json`, que a Vercel e a CI leem, os Dockerfiles e o
  `@types/node`) e muda à mão, nos três juntos, quando a Vercel suportar.
  A versão principal do TypeScript também não vem: ela espera o
  typescript-eslint, que roda no lint, aceitar a versão nova (o TS 7 ainda
  não é aceito).
- **Segredos:** push protection barra o push com chave conhecida; o secret
  scanning varre o histórico.
- **Código:** o CodeQL (conjunto `security-extended`) roda em todo PR.
- **Ao escrever código novo:** Server Action é endpoint público (checar
  quem chama e validar argumento), dado de pessoa vem da sessão (nunca do
  formulário), segredo não vai para o log, e e-mail só identifica alguém
  depois de confirmado.
