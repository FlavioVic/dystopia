# Deploy

A demo pública roda **de graça**, em três lugares:

| Peça | Onde | Por quê |
|---|---|---|
| App web + worker embutido | **Vercel** (Hobby) | serverless; drena a fila depois dos requests (ver abaixo) |
| Postgres | **Neon** (Free) | Postgres gerenciado; só acorda quando alguém usa o site |
| RabbitMQ | **CloudAMQP** (Little Lemur, grátis) | broker gerenciado, AMQP com TLS |

Os dois em US East (Neon `us-east-1`, Vercel `iad1`): cada página faz várias
queries, e a distância até o banco pesa mais que a distância até o visitante.

## Worker embutido (`INLINE_WORKER=1`)

Um worker de pé (`npm run worker` num container) precisa de um host pago
rodando o tempo todo — e o relay dele consulta a outbox a cada 500 ms, então o
banco serverless nunca dormiria e a cota grátis do Neon acabaria no meio do
mês. Então, na demo, ninguém fica de pé, e a fila é consumida **por pull**
(`basic.get`) em vez de push:

- **o checkout** avança a saga até o pagamento (como sempre) e, depois de
  responder (`after()`), publica a outbox e drena as filas: pagamento,
  resposta, e-mail — e, se o gateway oscilar, espera o retry voltar da fila
  de espera (até 45 s, dentro do `maxDuration` da rota);
- **a página do pedido**, enquanto está "processando", empurra a fila a cada
  atualização — se o dreno do checkout morrer no meio, ela termina;
- **o painel de orquestração** reconcilia e drena quando é aberto;
- **o cron diário** (`vercel.json` → `/api/cron/fila`, protegido por
  `CRON_SECRET`) é a rede de segurança para o que nenhum request empurrou.

O desenho não muda: o pedido continua nascendo com a mensagem na mesma
transação (outbox), pagamentos continua falando por mensagem (fila
`payments`), a política de retry e a DLQ são as mesmas, e vários drenos ao
mesmo tempo são seguros (o broker entrega cada mensagem a um consumidor só, o
relay usa `SKIP LOCKED` e a saga tem lease). Muda só **quem** consome —
`src/composition/worker.ts` monta os mesmos handlers para os dois executores. Com
tráfego de verdade, o caminho é subir o `Dockerfile.worker` num container e
desligar a flag.

## 1. Neon — banco

1. Novo projeto (plano **Free**), Postgres 18, região
   **AWS US East 1 (N. Virginia)**.
2. Em **Connect**, copie as duas strings de conexão:
   - **pooled** (host com `-pooler`, PgBouncer em modo transação) — Vercel,
     onde cada instância da função abre o próprio pool. O app não usa nada
     que dependa de sessão (advisory lock, `LISTEN`, `SET`), então o modo
     transação serve;
   - **direta** (host sem `-pooler`) — migrations, seed e operação, da sua
     máquina. É a do **dono** do banco (`neondb_owner`) e nunca vai para a
     Vercel.

   Nas duas, troque `sslmode=require` por `sslmode=verify-full`: é o que o
   `pg` já faz hoje (verifica o certificado), e o `require` vai enfraquecer
   numa versão futura do driver — ele avisa isso no log.
3. Migre e popule uma vez, pela string **direta** (a senha de admin fica só
   com você):

   ```bash
   export DATABASE_URL='<string direta do Neon>'
   npm run db:migrate
   SEED_ALLOW_REMOTE=1 SEED_ADMIN_PASSWORD="$(openssl rand -base64 24)" npm run db:seed
   ```

   Guarde a senha gerada num gerenciador antes — o seed não a imprime. Toda
   migration nova depois disso: o mesmo `npm run db:migrate`, antes do deploy
   que depende dela.
4. Crie o **usuário do app** — o que a Vercel usa. Ele só lê e grava linha:
   não apaga nem cria tabela, não lê o histórico de migrations
   (`src/db/app-role.ts`, provado em `tests/integration/db-app-role.test.ts`).
   Tem que ser por SQL (é o que o script faz): papel criado pelo console do
   Neon entra no `neon_superuser` e ganha bem mais que isso.

   ```bash
   export APP_DB_PASSWORD="$(openssl rand -base64 24)"   # guarde também
   npm run db:app-role                                    # ainda com a string direta do dono
   ```

   A `DATABASE_URL` do app é a string **pooled** com esse usuário no lugar do
   dono: `postgresql://dystopia_app:<APP_DB_PASSWORD>@<host-pooler>/neondb?sslmode=verify-full`
   (a senha em base64 pode ter `+`, `/` e `=`: na URL, escape com
   `encodeURIComponent`). As tabelas das próximas migrations já nascem
   liberadas para ele; rodar o script de novo só reaplica (e troca a senha).

## 2. CloudAMQP — RabbitMQ

1. Conta em <https://www.cloudamqp.com>, nova instância no plano **Little
   Lemur** (grátis), região **AWS US-East-1**.
2. Copie a **AMQP URL** (`amqps://…`) da página da instância — é a
   `RABBITMQ_URL`. As exchanges e filas são declaradas pelo próprio app na
   primeira conexão.

## 3. Vercel — app

1. **Add New → Project** → este repositório (framework detectado: Next.js).
2. Variáveis de ambiente (Production):
   - `DATABASE_URL` = a string **pooled** do Neon com o usuário
     `dystopia_app` (passo 1.4) — nunca a do dono
   - `RABBITMQ_URL` = a AMQP URL do CloudAMQP
   - `MFA_ENCRYPTION_KEY` = `openssl rand -base64 32` (nova, nunca a do `.env`
     local) — cifra o segredo do autenticador do admin no banco. A sessão não
     tem segredo: o cookie é um token aleatório e o banco guarda o hash dele
   - `PG_POOL_MAX` = `3` (cada instância da função tem o próprio pool)
   - `INLINE_WORKER` = `1` e `CRON_SECRET` = `openssl rand -base64 32`
   - `ALLOW_CHECKOUT_SIMULATION` = `1` — liga o **modo demonstração** no
     checkout (ver abaixo)
   - Opcionais (sem elas, cartão e e-mail são simulados):
     - `STRIPE_PUBLISHABLE_KEY` + `STRIPE_SECRET_KEY` — chaves de **teste**
       (`pk_test_…`/`sk_test_…`). Com o worker embutido, pagamentos roda no
       mesmo runtime do app, então a secreta vai para Vercel também — por isso
       só chave de teste é aceita.
     - `RESEND_API_KEY` + `EMAIL_REDIRECT_TO` = **o e-mail da sua conta no
       Resend** (modo sandbox: sem domínio próprio, o Resend só entrega para
       ele).
     - `CHAT_API_KEY` — chave da Groq (console.groq.com → API Keys, plano
       grátis sem cartão) para ligar o assistente. Sem ela, o botão não aparece.
       `CHAT_API_URL`/`CHAT_MODEL` trocam o provedor/modelo.
     - `SERVICE_ALERT_TO` — quem recebe o aviso de cada pedido de orçamento
       (gravado na mesma transação do pedido e entregue pela fila
       `notifications`).
     - **Fotos pelo painel** (galeria do produto): aba *Storage* do projeto →
       *Create* → **Blob**, acesso **público**, ligado ao projeto em
       Production. A Vercel cria `BLOB_READ_WRITE_TOKEN` sozinha; Redeploy.
       Grátis no Hobby até 1 GB, 2 mil envios e 10 GB de tráfego por mês — e
       passando disso o Blob bloqueia, não cobra. Sem o store, o painel avisa
       que o armazenamento não está configurado (o resto funciona).
3. Deploy. O `vercel.json` fixa as funções em `iad1` e registra o cron.
4. Com o repositório conectado (Settings → Git, ou `vercel git connect`), cada
   push na `main` publica sozinho. Migration nova continua manual: rode
   `npm run db:migrate` contra o Neon **antes** do push que depende dela.
   As outras branches não geram deploy (`git.deploymentEnabled` no
   `vercel.json`): as variáveis existem só em Production, então uma prévia
   falharia no build — e a branch já é verificada pelo CI.
5. **Analytics**: aba *Analytics* do projeto → *Enable* (grátis no Hobby). O
   script já está no layout e só carrega na Vercel.
6. **Primeiro acesso ao painel**: entre como admin. Sem autenticador, a loja
   manda para `/conta/seguranca`: escaneie o QR com o app (Google
   Authenticator, Authy, 1Password…), digite o código e **guarde os 10
   códigos de recuperação** fora do celular. Daí em diante o login do admin
   pede senha + código. Perdeu o celular: [`docs/RECUPERACAO.md`](RECUPERACAO.md).

Nunca reaproveite o `.env` local nem a senha `dystopia_dev_pw` do compose.

**Modo demonstração.** Com `ALLOW_CHECKOUT_SIMULATION=1`, o checkout mostra um
seletor para o visitante escolher o que o gateway responde — aprovar, recusar,
instável ou fora do ar — e ver a saga compensar ou tentar de novo. É seguro
porque nada é cobrado de verdade: o simulado não cobra, e o Stripe só aceita
chave de teste. A falha é injetada antes do provedor. No dia em que houver
cobrança real (chave de produção), a flag sai: cliente não pode escolher o
resultado da própria cobrança. Os modos "instável" e "fora do ar" dependem de
alguém consumir a fila (o retry volta por ela): o worker de pé ou, na demo, o
embutido.

## Fora da Vercel

A stack do `docker-compose.yml` (`--profile app`) é o ponto de partida para
hospedar em servidor próprio: app, worker e pagamentos em containers, com um
**Caddy na frente** (`docker/Caddyfile`). O proxy existe por segurança: ele
sobrescreve `X-Real-IP`/`X-Forwarded-For` com o IP real da conexão, e o app só
confia nesses headers com `TRUST_PROXY_HEADERS=1`. Sem proxy, o cliente forja
o IP e o limite de tentativas do login deixa de valer.

Antes de usar em produção: troque as senhas, o `APP_DB_PASSWORD` e a
`MFA_ENCRYPTION_KEY` (os do compose são de desenvolvimento), remova os
`*_LIMIT_*` (o compose aumenta todos para os testes) e desligue
`ALLOW_CHECKOUT_SIMULATION` se houver cobrança real.

