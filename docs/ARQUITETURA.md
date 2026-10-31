# Dystopia — arquitetura e guia de engenharia

Loja de peças de PC + serviços técnicos (orçamento) em Next.js 16 (App Router) + Postgres/Drizzle, projeto de portfólio de Flávio Victor. O checkout é
orquestrado por uma **SAGA** sobre **RabbitMQ** (com outbox transacional no
Postgres). Leia este arquivo antes de mexer em qualquer coisa de pedido,
estoque, pagamento ou fila.

## Comandos

| Comando | Para quê |
|---|---|
| `docker compose up -d` | Postgres de dev (porta 5544) + RabbitMQ (5672, painel 15672) |
| `npm run dev` | App em http://localhost:3000 |
| `npm run worker` | Consome as filas `saga` e `notifications`, publica a outbox (relay) e reconcilia — suba junto do dev |
| `npm run worker:payments` | Processo do serviço de pagamentos (fila `payments`) — sem ele, todo pedido fica "processando" |
| `npm run reconcile` | Reconciliação manual (libera leases, recria avanço de saga parada) |
| `npm test` | Suíte completa (cria/migra `dystopia_test` e usa filas `dystopia_test.*` sozinho) |
| `npm test -- <termo>` | Só os arquivos de teste com o termo no nome |
| `npm run test:unit` | Só os testes que não precisam de banco |
| `npm run lint` · `npx tsc --noEmit` | Lint e tipos — ambos têm que ficar limpos |
| `npm run db:generate` → `db:migrate` | Nova migration a partir de `src/db/schema.ts` (`db:migrate` aplica os dois bancos) |
| `npm run db:generate:payments` | Nova migration do banco de pagamentos (`src/services/payments/schema.ts` → `drizzle-payments/`) |
| `npm run db:seed` | Repopula o banco de dev (TRUNCATE + inserts) |
| `APP_DB_PASSWORD=… npm run db:app-role` | Cria/atualiza o usuário do app (`dystopia_app`, só DML). Roda com a conexão do dono, depois de migrar |

## Camadas (e a regra de dependência)

```
app/ + components/        borda: UI, rotas, formulários
lib/actions/*             borda HTTP (Server Actions): valida entrada, nada de regra
lib/assistant/*           borda conversacional: o chatbot chama dado e serviço
                          pelas mesmas portas que as telas usam
composition/web.ts        raiz da borda web: liga os casos de uso ao que só o
                          Next tem (o `after()` do worker embutido)
application/*             casos de uso: o que cruza mais de um serviço ou abre
                          transação (checkout, orçamento, LGPD, ligar o MFA)
saga/                     orquestração: ordem dos passos, retry, compensação
services/*                regra de negócio, uma responsabilidade cada
                          (inventory, payments, orders, coupons, carts,
                           accounts, sessions, mfa, notifications, catalog,
                           reviews, wishlist, addresses, rate-limit,
                           service-requests)
queue/                    fila genérica: outbox + relay, RabbitMQ, política
                          de retry (filas de espera com TTL), DLQ
shared/errors.ts          taxonomia de erro (PermanentError x RetryableError),
                          usada por serviços, fila e saga
db/                       schema Drizzle + pool + usuário do app (app-role.ts)
```

A dependência só aponta para baixo: **borda → aplicação → saga → serviços → db**.

- um **caso de uso** (`src/application`) não importa `next/*` nem a borda. Ele
  recebe a entrada já validada, compõe serviços (numa transação, quando é o
  caso) e, se deixou mensagem na outbox, chama `afterCommit` — sem saber se do
  outro lado tem worker em container ou o dreno do `after()`;
- a **borda do cliente** (páginas, actions, assistente) não importa `@/queue`,
  `@/saga/runner`, `@/saga/definitions` nem `composition/worker`: chama o caso
  de uso por `@/composition/web`. O painel de operação (`app/admin`, cron,
  `actions/admin.ts`) é a exceção — o trabalho dele é olhar a fila;
- a **borda do cliente** também não importa nada de `@/saga`, `lib/saga-ui` ou
  `components/admin`: o cliente acompanha o pedido pelos **eventos de domínio**
  dele (`order_events`, via `listOrderEvents`), na língua do pedido. A saga é
  visão de operação;
- um **serviço** não importa outro serviço (quem compõe é a saga ou o caso de
  uso), não importa `next/*`, não importa `lib/actions`/`lib/data`/`components`
  nem `saga/` (a taxonomia de erro mora em `src/shared`);
- a **fila** não conhece saga nenhuma em específico (só o registry de handlers)
  e não importa serviço nenhum;
- uma **Server Action** não escreve no banco nem abre transação: valida (parser
  de `lib/validation`), chama o serviço ou o caso de uso e traduz o resultado
  para a tela. Compor serviços numa transação é caso de uso;
- o **orquestrador** não conhece a definição concreta — chega nela via
  `src/saga/registry.ts`;
- **pagamentos roda em processo próprio, com banco próprio**: fora de
  `services/payments` (e dos scripts/composição que montam processos), só
  `@/services/payments/contract` pode ser importado — o banco dele
  (`services/payments/db.ts`, `PAYMENTS_DATABASE_URL`) e o schema dele não. O
  contrato não importa nada. A saga fala com ele por mensagem; a fila recebe
  os handlers dele por injeção (`startWorker({ handlers, outboxes })`), nunca
  importando o serviço. Cada banco tem a própria outbox; quem monta o processo
  diz quais publicar (`ALL_OUTBOXES` no worker embutido).

Isso não é só estilo: `tests/unit/architecture.test.ts` falha se alguém furar.
É o que mantém cada serviço extraível para um processo/deploy separado sem
reescrever regra.

## O fluxo do checkout

```
placeOrder (Server Action) → placeOrder (caso de uso, src/application/checkout.ts)
  └─ 1 transação: endereço + pedido(pending) + itens + saga + mensagem na outbox
         │  (o request não executa passo nenhum: grava e responde)
         └─ relay publica no RabbitMQ → o consumidor da fila `saga` avança
            (`npm run worker` em container; no deploy só-Vercel, o dreno do
             `after()` que o `afterCommit` liga — mesmo código de consumo)

passo remoto (pagamento):
  saga ── payments.authorize ──▶ fila `payments` ──▶ npm run worker:payments
  saga ◀──── saga.reply ─────── fila `saga` ◀── (cobrança + resposta: 1 tx)
  (as duas setas passam pela outbox de quem envia + relay)

SAGA checkout v2 (src/saga/definitions/checkout.ts)
  1 reserve-stock       inventory      compensável  ⇄ devolve as unidades
  2 consume-coupon      coupons        compensável  ⇄ devolve o uso
  3 authorize-payment   payments (remoto, por mensagem)   PIVÔ — ponto sem volta
  4 confirm-order       orders         retentável
  5 clear-cart          carts          retentável
  6 notify-customer     notifications  retentável

falha permanente até o pivô (inclusive) → compensa o que foi aplicado, em
                    ordem REVERSA, e cancela o pedido
falha depois do pivô → NUNCA desfaz: tenta de novo (8 tentativas) e, se não
                    andar, a saga para em `halted` até alguém retomar
falha transitória → retry com backoff; a saga SEGURA o lease até a hora do
                    retry, então mensagem duplicada não adianta a tentativa; no
                    passo remoto quem tenta de novo é o processo de pagamentos,
                    e na última tentativa ele RESPONDE com falha (a saga não
                    espera para sempre)
```

A saga roda na versão da definição com que começou (`sagas.definition_version`).
A v1 (cobrança antes do cupom, tudo compensável) fica em
`definitions/checkout.v1.ts` até não haver saga dela em andamento.

Estado durável: `sagas` (instância), `saga_steps` (log por passo = registro de
idempotência), `outbox` (caixa de saída) e as filas no RabbitMQ. Visível em
`/admin/orquestracao`.

### A fila (RabbitMQ)

Cada fila lógica (`saga`, `payments`, `notifications`) vira no broker: a fila
de trabalho `<p>.<fila>`, filas de espera `<p>.<fila>.retry.<ms>` (TTL +
dead-letter-exchange de volta para a de trabalho) e a DLQ `<p>.<fila>.dlq`. `<p>`
é `RABBITMQ_PREFIX` (`dystopia`; nos testes, `dystopia_test`). Topologia em
`src/queue/broker.ts`, política em `src/queue/worker.ts › handleDelivery`:

- handler ok → `ack`; lançou erro transitório (ou desconhecido) → fila de
  espera do backoff, tentativa + 1; `PermanentError`, tentativas esgotadas,
  mensagem ilegível ou tipo sem handler → DLQ (com o erro no cabeçalho);
- handler devolve `{ retryInMs, countAttempt: false }` para adiar sem ser falha
  (saga em backoff/ocupada) — não empurra para DLQ;
- `ack` só DEPOIS de encaminhar com publisher confirm: crash = reentrega,
  nunca perda. Por isso **todo handler é idempotente**;
- consumo por push (`startWorker`, processos de pé) ou pull (`drainQueues`,
  worker embutido e testes) — o mesmo `handleDelivery`.

## Invariantes (quebrar isso é bug, não escolha de estilo)

1. **Outbox**: mensagem é gravada (`enqueue` → tabela `outbox`) na MESMA
   transação do fato de negócio; só o relay publica no RabbitMQ. Nunca publique
   direto no broker de dentro de regra de negócio, nem depois do commit "na mão".
2. **Passo = transação**: o efeito do passo e o log dele (`saga_steps`)
   commitam juntos. Nunca faça um passo em duas transações. Passo remoto é a
   exceção controlada: o log vira `waiting` junto com o comando (outbox), o
   efeito commita do outro lado junto com a resposta (outbox), e a resposta é
   aplicada uma vez só (`applyStepReply` só mexe em passo `waiting`).
3. **Passo `completed` não roda de novo.** Toda retomada (retry, crash,
   reconciliação) reaproveita o log. Efeito externo precisa de chave de
   idempotência (ex.: `payments.idempotency_key`).
4. **Tentativa é contada antes de executar** — crash no meio não vira retry
   infinito.
5. **Erro tem taxonomia** (`src/shared/errors.ts`): `PermanentError` (regra
   de negócio → compensa já, ou para em `halted` depois do pivô) vs
   `RetryableError` (transitório → backoff). Erro desconhecido é tratado como
   transitório de propósito.
6. **Compensação é idempotente** e nunca lança por estado terminal.
6a. **Depois do pivô nada se desfaz.** A cobrança aprovada obriga a saga a
   terminar: passo retentável que não anda para a saga em `halted` (alerta
   crítico + "Retomar" no painel), nunca estorna.
6b. **Passo remoto tem prazo** (`timeoutMs` + `status` no passo). Vencido, a
   reconciliação pergunta o status ao outro serviço (ou reenvia o comando, que
   por isso tem que ser idempotente). Resultado desconhecido nunca vira
   compensação automática.
7. **Estoque sai com UPDATE condicional** (`where stock >= qtd`): se não
   atualizou linha, não tem estoque — erro permanente. Nunca `GREATEST(0, ...)`,
   que esconde venda sem estoque.
8. **Dinheiro em centavos** (`integer`), sempre. Nada de float.
9. **Totais são recalculados no servidor.** Valor que vem do cliente é palpite.
10. **Status de pedido passa pela máquina de estados** e **toda mudança de
    status grava um evento** (`order_events`) na mesma transação — é o
    histórico que o cliente vê; o motivo do cancelamento vai em código
    (`{ reason: "payment_declined" }`) e só a tela traduz (`describeCancellation`).
    Máquina e evento moram em `src/lib/order-status.ts` + `services/orders`
    (`transitionOrder`, `markOrderCancelled`). Não faça `update orders set
    status` na mão: o pedido mudaria sem deixar histórico.
11. Arquivo `"use server"` só pode exportar função async — constante, tipo e
    função sync vão para outro módulo. É por isso que validação de formulário
    mora em `lib/validation/*` (product, review, address, coupon, variant),
    regra pura de cupom em `services/coupons/rules.ts` e conversão de dinheiro
    em `lib/money.ts` (nunca duplique `toCents`).
12. Toda Server Action de admin chama `ensureAdmin()`. Layout protegido não
    basta: Server Action é endpoint público. **Admin = papel admin E MFA
    confirmado** (`isAdmin` em `lib/data/auth.ts`); senha sozinha não abre o
    painel.
13. **Sessão é linha no banco** (`sessions`), não token autocontido: quem a
    pessoa é sai de `getCurrentUser()` (sessão + usuário + MFA numa query,
    relida a cada request). Nunca guarde papel ou permissão no cookie. Sessão
    `mfaPending` (senha certa, código não) não é login para nada além de
    `/entrar/verificacao`.
14. **Código de uso único sai com UPDATE condicional**, como o estoque: o
    passo TOTP aceito só avança (`last_used_step < passo`), código de
    recuperação só marca se `used_at is null`. "Lê, confere e grava" deixaria
    dois logins usarem o mesmo código.
15. **O app conecta como `dystopia_app`** (só DML). Migration, seed e SQL de
    operação usam a conexão do dono. Código do app que precisar de DDL em
    runtime está errado por definição.
16. **Arquivo enviado é validado pelo conteúdo** (`lib/product-media.ts`:
    primeiros bytes; nome e `type` do navegador não contam), SVG nunca entra,
    e a chave do arquivo é gerada no servidor (`produtos/<id>/<uuid>.<ext>`).
    O armazenamento é uma interface com dois lados (`lib/media-storage.ts`):
    Vercel Blob com `BLOB_READ_WRITE_TOKEN`, pasta local fora da Vercel. A
    galeria (`services/catalog/images.ts`) guarda só a URL, com posição
    0..n-1 (0 = principal) e no máximo 10 fotos, garantido com a linha do
    produto travada.

## Como estender

**Novo passo na saga**: implemente a regra num serviço, escolha o papel
(`compensatable` com `compensate` antes do pivô; `retriable`, sem compensação,
depois dele) e dê um rótulo em `src/lib/saga-ui.ts`. Mudou a lista ou a ordem
dos passos? É uma **versão nova** da definição: copie a atual para
`checkout.vN.ts`, registre as duas em `src/saga/registry.ts` e suba o
`version` — saga em andamento guarda `current_step` e termina na versão dela.
O registry valida a forma (compensáveis → pivô → retentáveis) na subida.

**Novo passo remoto** (efeito em outro processo): no lugar de `invoke`, use
`request` (e `compensateRequest`) devolvendo `{ type, queue, payload }`; o
serviço publica isso num `contract.ts` e consome a fila com um handler que
grava o efeito + `sendReply` na mesma transação (ver
`services/payments/consumer.ts`). Esgotou as tentativas: responda com falha.

**Escrita que depende do estado atual** (somar quantidade, "já existe?"): uma
instrução só no banco — `INSERT ... ON CONFLICT`, `UPDATE ... WHERE` — nunca
"consulta, decide, escreve", que perde para duas requisições simultâneas. Ver
`services/carts` (`addItem`) e `services/accounts` (`registerAccount`).

**Novo formulário**: schema Zod em `src/lib/validation/<nome>.ts`, montado com
as peças de `validation/form.ts` (`requiredText`, `cents`, `wholeNumber`…) e
exposto como `parseXForm(formData)` → `FormResult` (`{ ok: true, values }` ou
`{ ok: false, errors }` — o tipo não deixa usar valor sem checar `ok`). Teste
unitário cobrindo os cantos; a Server Action só chama o parser + o serviço.

**Listagem**: paginada (`lib/pagination.ts`, `?pagina=`) com `limit`/`offset` e
total por `count(*)`; página além da última é 404. Nunca carregue a tabela
inteira para contar ou mostrar.

**Novo serviço**: pasta em `src/services/<nome>/` recebendo `Executor`
(`Database | Transaction`) como primeiro parâmetro — é o que permite compor
vários serviços numa transação só e testar com o banco de teste.

**Novo tipo de mensagem**: o produtor chama `enqueue(tx, { type, queue, payload })`
dentro da transação; o handler (`(message) => Promise<HandlerResult>`) entra
no registro da saga (`src/queue/handlers.ts`) ou, se for de um serviço, na raiz
de composição (`src/composition/worker.ts`). Fila nova: adicione em
`ALL_QUEUES` (composição) e em quem consome (`WORKER_QUEUES`/script). O
handler tem que ser idempotente (reentrega é normal) e lançar `PermanentError`
para o que retry não conserta.

**Mudança de schema**: edite `src/db/schema.ts` → `npm run db:generate` →
revise o SQL → `npm run db:migrate`. Nunca edite migration já aplicada.

## Testes

- `tests/unit/` — função pura, sem banco (`npm run test:unit`).
- `tests/integration/` — Postgres e RabbitMQ reais, rodando em série;
  `resetDatabase()` no `beforeEach` (trunca e esvazia as filas de teste) e
  `closeDatabase()` no `after` (fecha pool e conexão AMQP — senão o processo
  não encerra). Retry passa de verdade pelas filas de espera (50–400 ms nos
  testes): espere com `waitForRetries()`, não adiante relógio.
- `tests/e2e/` — navegador (Playwright, `npm run test:e2e`) contra a loja
  rodando — por padrão a stack do `docker compose --profile app`. A fixture
  falha o teste em qualquer erro de console ou violação de CSP; o
  `acessibilidade.spec.ts` roda o axe (WCAG 2.1 AA) nas páginas públicas,
  da conta e do admin. Os testes compram de verdade e rodam em paralelo:
  não dependa do "primeiro produto da lista" nem de estoque fixo.
  `stripe.spec.ts` paga pelo Stripe real (modo de teste: `4242…` aprova,
  `4000 0000 0000 0002` recusa) e se pula quando o app não tem chave — na
  stack, `STRIPE_PUBLISHABLE_KEY`/`STRIPE_SECRET_KEY` de teste no `.env`; no
  CI, secrets do repositório. A fixture ignora só falha de REDE para domínio
  do Stripe (antifraude bloqueado por DNS/adblock), nunca violação de CSP.
- `tests/integration/migrations.test.ts` — migration que transforma DADO
  ganha teste: banco descartável, aplica até a anterior, insere dados no
  formato antigo, aplica e confere.
- `tests/helpers/` — fixtures (`seedCheckoutFixture`), o atalho `startCheckout`,
  que monta o pedido igual à Server Action, e `work()`/`settleSaga()`/
  `pendingWork()` para consumir e inspecionar as filas.
- O runner (`tests/run.ts`) deriva o banco de teste do `DATABASE_URL`
  (`..._test`), cria e migra sozinho.
- Teste de comportamento, não de implementação: os casos de saga checam o
  **efeito** (estoque, cobrança, status, carrinho), não a chamada interna.
- CI (`.github/workflows/ci.yml`) repete a sequência completa com Postgres e
  RabbitMQ de verdade: tipos → lint → migrations em banco limpo → testes →
  build. Se passar local e quebrar no CI, suspeite de algo que depende do
  banco de dev já populado.

## Convenções

- Código e comentário em **pt-BR**; comentário explica *por quê*, não *o quê*.
- Sem dependência nova sem motivo forte (hoje: next, react, drizzle, pg,
  amqplib, zod, bcryptjs, qrcode, @vercel/blob, dotenv; em dev, Playwright
  para os testes de navegador). O `overrides` do package.json força o `zod`
  do projeto dentro do `@vercel/cli-config` (dependência do Blob, que fixava
  um 4.1 com vulnerabilidade alta); não remova sem rodar `npm audit`. O `jose` saiu com o JWT. O TOTP é o RFC 6238 em cima do
  HMAC do `node:crypto` (`services/mfa/totp.ts`, com os vetores do RFC no
  teste); QR code é Reed-Solomon, então esse vem de biblioteca. Saga, relay, política de retry, logger e
  runner de teste são caseiros de propósito; o Stripe é chamado via `fetch`
  (sem SDK) e o Stripe.js vem de js.stripe.com, como o Stripe exige. O
  modelo do assistente também é chamado via `fetch`, no protocolo Chat
  Completions (Groq por padrão; outro provedor = trocar `CHAT_API_URL`/`CHAT_MODEL`).
- **Assistente** (`lib/assistant`, `POST /api/assistente`): o modelo escolhe
  ferramenta e argumento, mas QUEM é a pessoa vem da sessão, nunca de
  argumento — pedido de outra conta é "não encontrado". Argumento passa por
  Zod; orçamento pelo chat usa o MESMO caso de uso do formulário
  (`application/service-requests.ts`, com o mesmo limite por IP); link na
  resposta só para caminho interno (`rich-text.ts`). Sem `CHAT_API_KEY` o
  botão não aparece. Teste: o modelo é falso nos testes (roteiro de respostas),
  as ferramentas rodam contra o banco real.
- Efeito externo nunca sai de dentro da transação de um passo: e-mail é
  gravado no passo e entregue por mensagem (`notifications.deliver`), com
  `Idempotency-Key`. Com `RESEND_API_KEY`, `EMAIL_REDIRECT_TO` é obrigatório
  (sandbox) — demo pública não manda e-mail para quem se cadastrou.
- Chave secreta do Stripe só no processo de pagamentos; o app web usa só a
  pública (`lib/stripe-public.ts`). Só chave de teste é aceita. Exceção
  consciente: com `INLINE_WORKER=1` (demo só-Vercel) pagamentos roda no
  mesmo runtime do app, então a secreta de teste vai para Vercel também.
- **Worker embutido** (`INLINE_WORKER=1`, `src/composition/web.ts`): sem
  worker de pé, os casos de uso que deixam mensagem na outbox (checkout,
  orçamento), a página do pedido em andamento e o painel de orquestração
  publicam a outbox e drenam o RabbitMQ por pull no `after()`, e
  `/api/cron/fila` (cron da Vercel) é a rede de segurança. A borda não sabe
  disso: quem decide é a raiz de composição. Quem pluga os handlers é
  `src/composition/worker.ts`, o mesmo que o `npm run worker` usa — a fila e a
  saga não mudam. Broker do deploy: CloudAMQP (plano grátis), `RABBITMQ_URL`.
- Identidade do design system "DYSTOPIA": tokens de `globals.css` por papel
  (`background`, `foreground`, `border`, `signal`…) — não chute hex novo. Cantos
  retos, sem sombra/gradiente/tinta. Vermelho é a cor de AÇÃO (pedido do dono):
  `bg-primary` + `text-primary-foreground` em botões/faixas; texto vermelho
  pequeno só com `text-signal-text` (o `signal`/`primary` puro só ≥24px).
  Seção de página ganha faixa própria com `<Sector tone="crimson|graphite|bone">`
  do kit (as classes `.sector-*` redefinem os papéis dentro da faixa, então o
  componente não muda) — não empilhe seção após seção no mesmo obsidian. Kit em
  `components/Kit.tsx`; marca só via `components/Logo.tsx` (geometria em
  `lib/brand-geometry.ts`, nunca redesenhe). Voz declarativa, sem exclamação.
- Michroma (`display-*`) nunca abaixo de 12px; no celular, nome longo vai em
  `label` (mono). Grade sem coluna explícita no celular estoura a largura:
  sempre `grid-cols-1` antes do `sm:` (e `min-w-0` na célula se tiver Michroma).
- Foto de produto só do modelo exato e com licença livre (`lib/photo-credits.ts`,
  teste em `tests/unit/media-assets.test.ts`). Em produção, mídia do catálogo
  muda com `npm run catalog:media`, não com o seed (que apaga contas).
- Animação: `Reveal`/`CountUp` (`components/Motion.tsx`) e classes em
  `globals.css`; respeite `prefers-reduced-motion`.
- Data layer em `src/lib/data/*` com `cache()` do React; mutação em
  `src/lib/actions/*`.

## Pegadinhas conhecidas

- `next/image` devolve 400 para SVG sem `images.dangerouslyAllowSVG`
  (já configurado); mudança em `next.config.ts` exige reiniciar o dev server.
- **CSP com nonce** (`src/proxy.ts`, `lib/csp.ts`): todo `<script>` escrito à
  mão precisa de `nonce={nonce}` (lido do header `x-nonce`, como no layout),
  senão o navegador bloqueia. Script carregado por outro script confiável
  passa pelo `strict-dynamic`.
- **IP do cliente** (`lib/request-ip.ts`) só vem de header quando há quem o
  escreva por nós: Vercel, ou proxy próprio com `TRUST_PROXY_HEADERS=1` (o
  Caddy do compose). Sem isso o cliente forja `X-Forwarded-For` e fura o
  limite de tentativas; em produção o código falha fechado.
- **Sem `loading.tsx` na raiz**: com ele a página vai em streaming e o
  `notFound()` responde 200 em vez de 404.
- `tsx` compila para CJS: **sem top-level await** em script (`src/scripts/*`
  usa `main().catch(...)`).
- `generateOrderNumber` usa o ano **local** — teste com `new Date(2026, 0, 1)`,
  não com string UTC.
- **Hora gravada pelo banco se compara com o relógio do banco.** Coluna com
  `defaultNow()` (ex.: `outbox.next_attempt_at`) tem microssegundos do
  Postgres; `new Date()` do Node tem milissegundos e pode ser de outra
  máquina. O relay comparava com o Node e pulava a mensagem gravada no mesmo
  milissegundo — no CI, um teste falhava de vez em quando. Use `sql\`now()\``.
- **Playwright compila os testes como CommonJS**: em `tests/e2e`, use
  `__dirname`, não `import.meta`.
- **Admin no e2e**: cada código TOTP vale uma vez, então os testes não logam o
  admin cada um por si. O projeto `setup` (`tests/e2e/admin.setup.ts`) entra
  uma vez — cadastrando o autenticador pela tela numa stack recém-semeada — e
  guarda a sessão e o segredo em `playwright/.auth/` (fora do git); os testes
  do painel usam `test.use({ storageState: ADMIN_STATE })`.
- Rota nova com `PageProps<"/rota">` só passa no `tsc` depois de
  `npx next typegen` (ou de um `dev`/`build`), que gera os tipos das rotas.
- Server Action não dá para chamar com curl ingenuamente (protocolo RSC): o
  id vem do bundle, os argumentos vão no campo `0` do multipart, e os campos
  de um `FormData` (`_1_<nome>`) têm que vir ANTES do `0`.
