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
| `npm run db:generate` → `db:migrate` | Nova migration a partir de `src/db/schema.ts` |
| `npm run db:seed` | Repopula o banco de dev (TRUNCATE + inserts) |

## Camadas (e a regra de dependência)

```
app/ + components/        borda: UI, rotas, formulários
lib/actions/*             borda HTTP (Server Actions): valida entrada, nada de regra
saga/                     orquestração: ordem dos passos, retry, compensação
services/*                regra de negócio, uma responsabilidade cada
                          (inventory, payments, orders, coupons, carts,
                           accounts, notifications, catalog, reviews, wishlist,
                           addresses, rate-limit, service-requests)
queue/                    fila genérica: outbox + relay, RabbitMQ, política
                          de retry (filas de espera com TTL), DLQ
db/                       schema Drizzle + pool
```

A dependência só aponta para baixo: **borda → saga → serviços → db**.

- um **serviço** não importa outro serviço (quem compõe é a saga), não importa
  `next/*`, não importa `lib/actions`/`lib/data`/`components`. Do `saga/` ele
  só pode importar `@/saga/errors`;
- a **fila** não conhece saga nenhuma em específico (só o registry de handlers)
  e não importa serviço nenhum;
- uma **Server Action** não escreve no banco: valida (parser de
  `lib/validation`), chama o serviço e traduz o resultado para a tela. Abrir uma
  transação para compor serviços pode (é o outbox do checkout);
- o **orquestrador** não conhece a definição concreta — chega nela via
  `src/saga/registry.ts`;
- **pagamentos roda em processo próprio**: fora de `services/payments` (e dos
  scripts que montam processos), só `@/services/payments/contract` pode ser
  importado. A saga fala com ele por mensagem; a fila recebe os handlers dele
  por injeção (`startWorker({ handlers })`), nunca importando o serviço.

Isso não é só estilo: `tests/unit/architecture.test.ts` falha se alguém furar.
É o que mantém cada serviço extraível para um processo/deploy separado sem
reescrever regra.

## O fluxo do checkout

```
placeOrder (Server Action)
  └─ 1 transação: endereço + pedido(pending) + itens + saga + mensagem na outbox
         │
         ├─ caminho rápido: o próprio request avança a saga (tryRunSagaInline)
         │                  até o pagamento, que é remoto → saga em `waiting`
         └─ caminho durável: relay publica no RabbitMQ → `npm run worker`
                 consome a fila `saga`
                 (lease na saga garante que só um dos dois avança por vez)

passo remoto (pagamento):
  saga ── payments.authorize ──▶ fila `payments` ──▶ npm run worker:payments
  saga ◀──── saga.reply ─────── fila `saga` ◀── (cobrança + resposta: 1 tx)
  (as duas setas passam pela outbox de quem envia + relay)

SAGA checkout (src/saga/definitions/checkout.ts)
  1 reserve-stock       inventory      ⇄ devolve as unidades
  2 authorize-payment   payments (remoto, por mensagem)  ⇄ estorna (também por mensagem)
  3 consume-coupon      coupons        ⇄ devolve o uso
  4 confirm-order       orders         ⇄ cancela o pedido
  5 clear-cart          carts          ⇄ restaura os itens
  6 notify-customer     notifications  (sem compensação)

falha permanente em qualquer passo → compensa de 1..n-1 em ordem REVERSA
falha transitória → retry com backoff (3 tentativas por passo); a saga SEGURA
                    o lease até a hora do retry, então mensagem duplicada não
                    adianta a tentativa; no passo remoto quem tenta de novo é o
                    processo de pagamentos, e na última tentativa ele RESPONDE
                    com falha (a saga não espera para sempre)
```

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
5. **Erro tem taxonomia**: `PermanentError` (regra de negócio → compensa já) vs
   `RetryableError` (transitório → backoff). Erro desconhecido é tratado como
   transitório de propósito.
6. **Compensação é idempotente** e nunca lança por estado terminal.
7. **Estoque sai com UPDATE condicional** (`where stock >= qtd`): se não
   atualizou linha, não tem estoque — erro permanente. Nunca `GREATEST(0, ...)`,
   que esconde venda sem estoque.
8. **Dinheiro em centavos** (`integer`), sempre. Nada de float.
9. **Totais são recalculados no servidor.** Valor que vem do cliente é palpite.
10. **Status de pedido passa pela máquina de estados** (`src/lib/order-status.ts`
    + `transitionOrder`). Não faça `update orders set status` na mão.
11. Arquivo `"use server"` só pode exportar função async — constante, tipo e
    função sync vão para outro módulo. É por isso que validação de formulário
    mora em `lib/validation/*` (product, review, address, coupon, variant),
    regra pura de cupom em `services/coupons/rules.ts` e conversão de dinheiro
    em `lib/money.ts` (nunca duplique `toCents`).
12. Toda Server Action de admin chama `ensureAdmin()`. Layout protegido não
    basta: Server Action é endpoint público.

## Como estender

**Novo passo na saga**: adicione em `steps` de `src/saga/definitions/checkout.ts`
com `invoke` + `compensate`, implemente a regra num serviço, e dê um rótulo em
`src/lib/saga-ui.ts`. Passo novo entra **no fim** se já houver saga em voo em
produção (saga antiga guarda `current_step`; inserir no meio desalinha a
retomada).

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
  amqplib, zod, jose, bcryptjs, dotenv; em dev, Playwright para os testes de
  navegador). Saga, relay, política de retry, logger e
  runner de teste são caseiros de propósito; o Stripe é chamado via `fetch`
  (sem SDK) e o Stripe.js vem de js.stripe.com, como o Stripe exige.
- Efeito externo nunca sai de dentro da transação de um passo: e-mail é
  gravado no passo e entregue por mensagem (`notifications.deliver`), com
  `Idempotency-Key`. Com `RESEND_API_KEY`, `EMAIL_REDIRECT_TO` é obrigatório
  (sandbox) — demo pública não manda e-mail para quem se cadastrou.
- Chave secreta do Stripe só no processo de pagamentos; o app web usa só a
  pública (`lib/stripe-public.ts`). Só chave de teste é aceita. Exceção
  consciente: com `INLINE_WORKER=1` (demo só-Vercel) pagamentos roda no
  mesmo runtime do app, então a secreta de teste vai para Vercel também.
- **Worker embutido** (`INLINE_WORKER=1`, `src/lib/inline-worker.ts`): sem
  worker de pé, checkout, página do pedido e painel de orquestração publicam
  a outbox e drenam o RabbitMQ por pull no `after()`, e `/api/cron/fila` (cron
  da Vercel) é a rede de segurança. Quem pluga os handlers é
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
- Server Action não dá para chamar com curl ingenuamente (protocolo RSC): o
  id vem do bundle, os argumentos vão no campo `0` do multipart, e os campos
  de um `FormData` (`_1_<nome>`) têm que vir ANTES do `0`.
