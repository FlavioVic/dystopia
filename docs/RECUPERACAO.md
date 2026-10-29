# Plano de recuperação

O que fazer quando algo dá errado em produção, do mais provável ao mais raro.
Cada seção diz **o que se perde**, **quanto tempo leva** e **o comando**.

Produção: Vercel (projeto `dystopia`), Neon (projeto `calm-snow-13721571`,
branch `production`), CloudAMQP (Little Lemur). Comandos que tocam o banco
usam a string **direta** do dono (`neondb_owner`), nunca a do app:

```bash
# WSL sem IPv6: sem estas opções o Node desiste do Neon antes de conectar.
export NODE_OPTIONS="--no-network-family-autoselection --dns-result-order=ipv4first"
export DATABASE_URL="$(neon connection-string --project-id calm-snow-13721571 --pooled false)"
```

## Limites honestos (plano grátis)

| | Valor | De onde vem |
|---|---|---|
| Volta no tempo do banco | **6 horas** | `history_retention_seconds = 21600` do projeto Neon (Free) |
| Backup além disso | só o que você tirar com `pg_dump` | nenhum serviço pago de backup |
| Fila | não guarda nada que o banco não tenha | outbox no Postgres é a fonte da verdade |
| Deploy anterior | qualquer um da lista da Vercel | rollback instantâneo |

Regra que sai disso: **antes de qualquer operação arriscada no banco**
(migration que converte dado, script de manutenção, SQL na mão), tire um dump:

```bash
pg_dump "$DATABASE_URL" -Fc -f "backup-$(date +%F-%H%M).dump"
```

## 1. Deploy quebrou o site

**Perde:** nada. **Leva:** 1 minuto.

1. Vercel → projeto → *Deployments* → o último que funcionava → **Instant
   Rollback** (ou `vercel rollback` na pasta do projeto).
2. Reverta o merge na `main` (`git revert -m 1 <merge>` + PR) — senão o
   próximo push publica o problema de novo.

Migration não volta com o rollback. Por isso migration aqui é sempre
**aditiva** (coluna/tabela nova, nunca renomear ou apagar no mesmo deploy):
o código anterior continua funcionando com o schema novo. Apagar coluna é um
segundo deploy, depois que nenhum código usa mais.

## 2. Dado apagado ou estragado (há menos de 6 horas)

**Perde:** o que entrou depois do instante escolhido. **Leva:** minutos.

Primeiro olhe sem mexer em produção — um branch no ponto antes do estrago:

```bash
# Sem nome de branch no --parent, o instante é do branch padrão (production).
neon branches create --project-id calm-snow-13721571 \
  --name recuperacao --parent 2026-10-29T12:00:00Z
neon connection-string recuperacao --project-id calm-snow-13721571 --pooled false
```

Daí, duas saídas:

- **Estrago pequeno** (umas linhas): copie do branch `recuperacao` para
  produção só o que falta (`pg_dump --data-only -t <tabela>` do branch,
  `psql` em produção) e apague o branch.
- **Estrago grande**: volte o branch inteiro, guardando o estado atual com
  outro nome (dá para desfazer):

  ```bash
  neon branches restore production '^self@2026-10-29T12:00:00Z' \
    --project-id calm-snow-13721571 --preserve-under-name production-antes-do-restore
  ```

  Depois: `npm run reconcile` (com a `DATABASE_URL` do dono) para as sagas
  que estavam no meio voltarem a andar, e confira `/admin/orquestracao`.

Mais de 6 horas: só com o último `pg_dump` (`pg_restore` num branch novo e
copie o que precisar).

## 3. Fila: mensagens perdidas ou CloudAMQP fora/apagado

**Perde:** nada que importe. **Leva:** 5 minutos (instância nova).

Toda mensagem nasce na tabela `outbox`, na mesma transação do pedido; o
RabbitMQ só transporta. Se o broker perder mensagens ou a instância sumir:

1. CloudAMQP → instância nova (Little Lemur, US-East-1) → copie a URL.
2. Vercel → `RABBITMQ_URL` → nova URL → Redeploy. Filas e exchanges o app
   declara sozinho.
3. A reconciliação (worker, cron diário `/api/cron/fila` ou o botão em
   `/admin/orquestracao`) acha toda saga parada há mais de 1 minuto e grava
   um avanço novo na outbox. O log de passos impede refazer o que já foi
   feito (estoque não sai duas vezes, cobrança tem chave de idempotência).

## 4. Segredo vazou

Trocar sempre: gerar o novo, pôr na Vercel (*Settings → Environment
Variables*, Production), **Redeploy**, e só então invalidar o antigo.

| Segredo | Como trocar | Efeito colateral |
|---|---|---|
| `DATABASE_URL` (usuário `dystopia_app`) | `APP_DB_PASSWORD="$(openssl rand -base64 24)" npm run db:app-role` (troca a senha do papel) e monte a URL nova | nenhum |
| Senha do dono (`neondb_owner`) | Neon Console → *Roles* → *Reset password* | só scripts de operação usam |
| `MFA_ENCRYPTION_KEY` | chave nova + **refazer o MFA do admin** (seção 5, sem celular) | o autenticador cadastrado para de abrir; o admin cadastra de novo |
| `CRON_SECRET` | `openssl rand -base64 32` | nenhum (a Vercel manda o novo) |
| `RABBITMQ_URL` | instância nova no CloudAMQP (seção 3) — o plano grátis leva 5 minutos e não tem o que migrar | nenhum |
| `RESEND_API_KEY`, `CHAT_API_KEY`, chaves do Stripe | painel do provedor → chave nova → apagar a antiga | nenhum |

A chave do MFA sozinha não abre nada: precisa também de uma cópia do banco
(o segredo cifrado) e da senha do admin.

**Derrubar logins** (sessão roubada, conta comprometida) — vale na hora,
porque sessão é linha no banco:

```sql
delete from sessions where user_id = (select id from users where email = 'alguem@exemplo.com');
delete from sessions;  -- todo mundo
```

## 5. Admin sem acesso ao autenticador

- **Tem código de recuperação**: entre com ele no lugar dos 6 dígitos →
  `/conta/seguranca` → *Celular novo* → confirme com outro código de
  recuperação → cadastre o app no aparelho novo (códigos novos saem junto).
- **Sem código nenhum**: quem prova que é o dono agora é o acesso ao Neon.
  Com a `DATABASE_URL` do dono:

  ```sql
  begin;
  delete from mfa_recovery_codes where user_id = (select id from users where email = 'admin@dystopia.dev');
  delete from mfa_credentials    where user_id = (select id from users where email = 'admin@dystopia.dev');
  delete from sessions           where user_id = (select id from users where email = 'admin@dystopia.dev');
  commit;
  ```

  Depois: login com a senha → a loja manda para `/conta/seguranca` →
  cadastra o autenticador de novo.

## 6. Conta do admin comprometida

1. Derrube as sessões dele (seção 4).
2. Senha nova (não há tela de troca de senha; vai pelo banco):

   ```bash
   node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" "$(openssl rand -base64 24)"
   ```

   ```sql
   update users set password_hash = '<hash>' where email = 'admin@dystopia.dev';
   ```

3. Refaça o MFA (seção 5, sem celular) e cadastre num aparelho seu.
4. Olhe o que mudou: pedidos (`/admin/pedidos`), produtos, cupons. Se algo
   foi estragado há menos de 6 horas, seção 2.

## Ensaio

Um plano que nunca rodou é palpite. O que já é exercitado sempre:

- **sessão revogada não entra**, **MFA**, **usuário do app sem DDL**:
  `tests/integration/sessions.test.ts`, `mfa.test.ts`, `db-app-role.test.ts`;
- **fila perdida não perde pedido**: `tests/integration/reconcile.test.ts`
  e os testes de DLQ em `queue.test.ts`.

Para ensaiar a volta no tempo sem risco: crie um branch, apague algo nele e
recupere com a seção 2 apontando para o branch em vez de `production`.
