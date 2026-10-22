<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Dystopia — guia de engenharia

E-commerce geek em Next.js 16 (App Router) + Postgres/Drizzle. O checkout é
orquestrado por uma **SAGA** com fila durável. Leia este arquivo antes de
mexer em qualquer coisa de pedido, estoque, pagamento ou fila.

## Comandos

| Comando | Pra quê |
|---|---|
| `docker compose up -d` | Postgres de dev na porta 5544 (só o banco) |
| `npm run dev` | App em http://localhost:3000 |
| `npm run worker` | Worker da fila (processa as sagas) — suba junto do dev |
| `npm run reconcile` | Reconciliação manual (libera leases, reenfileira sagas órfãs) |
| `npm test` | Suíte completa (cria/migra `dystopia_test` sozinho) |
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
                           notifications, catalog, reviews, wishlist, addresses,
                           rate-limit)
queue/                    fila genérica (jobs, claim, backoff, DLQ)
db/                       schema Drizzle + pool
```

A dependência só aponta pra baixo: **borda → saga → serviços → db**.

- um **serviço** não importa outro serviço (quem compõe é a saga), não importa
  `next/*`, não importa `lib/actions`/`lib/data`/`components`. Do `saga/` ele
  só pode importar `@/saga/errors`;
- a **fila** não conhece saga nenhuma em específico (só o registry de handlers);
- o **orquestrador** não conhece a definição concreta — chega nela via
  `src/saga/registry.ts`.

Isso não é só estilo: `tests/unit/architecture.test.ts` falha se alguém furar.
É o que mantém cada serviço extraível pra um processo/deploy separado sem
reescrever regra.

## O fluxo do checkout

```
placeOrder (Server Action)
  └─ 1 transação: endereço + pedido(pending) + itens + saga + job   ← outbox
         │
         ├─ caminho rápido: o próprio request avança a saga (tryRunSagaInline)
         └─ caminho durável: `npm run worker` pega o job da fila
                 (lease na saga garante que só um dos dois avança por vez)

SAGA checkout (src/saga/definitions/checkout.ts)
  1 reserve-stock       inventory      ⇄ devolve as unidades
  2 authorize-payment   payments       ⇄ estorna
  3 consume-coupon      coupons        ⇄ devolve o uso
  4 confirm-order       orders         ⇄ cancela o pedido
  5 clear-cart          carts          ⇄ restaura os itens
  6 notify-customer     notifications  (sem compensação)

falha permanente em qualquer passo → compensa de 1..n-1 em ordem REVERSA
falha transitória → volta pra fila com backoff (3 tentativas por passo)
```

Estado durável: `sagas` (instância), `saga_steps` (log por passo = registro de
idempotência), `jobs` (fila). Visível em `/admin/orquestracao`.

## Invariantes (quebrar isso é bug, não escolha de estilo)

1. **Outbox**: job de saga é inserido na MESMA transação do fato de negócio.
   Nunca enfileire depois do commit.
2. **Passo = transação**: o efeito do passo e o log dele (`saga_steps`)
   commitam juntos. Nunca faça um passo em duas transações.
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
    função sync vão pra outro módulo. É por isso que validação de formulário
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

**Novo formulário**: validação pura em `src/lib/validation/<nome>.ts`
(entra `FormData`, sai `{ errors, values }`), teste unitário cobrindo os cantos,
e a Server Action só chama o parser + o serviço.

**Novo serviço**: pasta em `src/services/<nome>/` recebendo `Executor`
(`Database | Transaction`) como primeiro parâmetro — é o que permite compor
vários serviços numa transação só e testar com o banco de teste.

**Novo tipo de job**: registre em `src/queue/handlers.ts`. Devolva
`{ settled: true }` só se o handler mesmo cuidar do destino do job.

**Mudança de schema**: edite `src/db/schema.ts` → `npm run db:generate` →
revise o SQL → `npm run db:migrate`. Nunca edite migration já aplicada.

## Testes

- `tests/unit/` — função pura, sem banco (`npm run test:unit`).
- `tests/integration/` — Postgres real, rodando em série; `resetDatabase()` no
  `beforeEach` e `closeDatabase()` no `after` (senão o processo não encerra).
- `tests/helpers/` — fixtures (`seedCheckoutFixture`) e o atalho `startCheckout`,
  que monta o pedido igual à Server Action.
- O runner (`tests/run.ts`) deriva o banco de teste do `DATABASE_URL`
  (`..._test`), cria e migra sozinho.
- Teste de comportamento, não de implementação: os casos de saga checam o
  **efeito** (estoque, cobrança, status, carrinho), não a chamada interna.
- CI (`.github/workflows/ci.yml`) repete a sequência completa com Postgres de
  verdade: tipos → lint → migrations em banco limpo → testes → build. Se passar
  local e quebrar no CI, suspeite de algo que depende do banco de dev já
  populado.

## Convenções

- Código e comentário em **pt-BR**; comentário explica *por quê*, não *o quê*.
- Sem dependência nova sem motivo forte (hoje: next, react, drizzle, pg, jose,
  bcryptjs, dotenv). Fila, saga, logger e runner de teste são caseiros de
  propósito.
- Tailwind com os tokens de `globals.css` (`--accent`, `--deal`, `border`,
  `foreground-muted`…). Não chute hex novo.
- Data layer em `src/lib/data/*` com `cache()` do React; mutação em
  `src/lib/actions/*`.

## Pegadinhas conhecidas

- `next/image` devolve 400 pra SVG sem `images.dangerouslyAllowSVG`
  (já configurado); mudança em `next.config.ts` exige reiniciar o dev server.
- `tsx` compila pra CJS: **sem top-level await** em script (`src/scripts/*`
  usa `main().catch(...)`).
- `generateOrderNumber` usa o ano **local** — teste com `new Date(2026, 0, 1)`,
  não com string UTC.
- Server Action não dá pra chamar com curl ingenuamente (protocolo RSC). Tem
  receita em `CLAUDE.md`.
