# Decisões de arquitetura

Registro das escolhas que dão forma à DYSTOPIA: o problema, o que foi decidido,
o que ficou de fora e por quê, e o preço pago. É o "por quê" que o código não
conta sozinho. Os detalhes de funcionamento estão em
[`SAGA-E-FILA.md`](SAGA-E-FILA.md) e [`ARQUITETURA.md`](ARQUITETURA.md).

| # | Decisão | Em uma linha |
|---|---|---|
| 1 | [Checkout como SAGA orquestrada](#1-checkout-como-saga-orquestrada) | Cada passo é uma transação; a cobrança é o ponto sem volta |
| 2 | [RabbitMQ como broker](#2-rabbitmq-como-broker) | Fila de trabalho com ack, atraso e DLQ prontos |
| 3 | [Outbox transacional](#3-outbox-transacional) | A mensagem nasce no mesmo commit do pedido |
| 4 | [Retry por filas de espera e DLQ](#4-retry-por-filas-de-espera-e-dlq) | Backoff planejado; erro de regra não tenta de novo |
| 5 | [Pelo menos uma vez + idempotência](#5-pelo-menos-uma-vez--idempotência) | Duplicata é aceita; efeito duplicado, não |
| 6 | [Pagamentos em processo próprio](#6-pagamentos-em-processo-próprio) | O único passo que fala com o mundo de fora só conversa por mensagem |
| 7 | [Monólito modular, fronteiras testadas](#7-monólito-modular-fronteiras-testadas) | Serviços separados por regra, não por deploy; casos de uso numa camada própria |
| 8 | [Custo zero: worker embutido na Vercel](#8-custo-zero-worker-embutido-na-vercel) | Ninguém de pé; a fila é drenada depois do request |
| 9 | [Sessão no banco, não JWT](#9-sessão-no-banco-não-jwt) | Sair derruba o login na hora |
| 10 | [MFA no painel](#10-mfa-totp-obrigatório-no-painel) | Senha vazada sozinha não abre o admin |
| 11 | [Menor privilégio no banco](#11-o-app-conecta-com-menor-privilégio) | O app não consegue apagar tabela |
| 12 | [Fotos no Vercel Blob](#12-fotos-no-vercel-blob) | Arquivo fora do servidor, validado pelo conteúdo |
| 13 | [Limite de tentativas no Postgres](#13-limite-de-tentativas-contado-no-postgres) | Contador que vale entre instâncias serverless |
| 14 | [Busca com full-text do Postgres](#14-busca-com-o-full-text-do-postgres) | Sem serviço de busca à parte |
| 15 | [Testes contra infraestrutura real](#15-testes-contra-infraestrutura-real) | Postgres, RabbitMQ e Stripe de verdade, não mocks |

---

## 1. Checkout como SAGA orquestrada

**Problema.** O checkout mexe em estoque, pagamento, cupom, pedido, carrinho e
e-mail. Numa transação só, funciona até o pagamento virar uma chamada HTTP a um
provedor — o provedor não participa do `COMMIT`. Se a cobrança passa e o banco
falha depois (ou o contrário), sobra dinheiro cobrado sem pedido, ou pedido sem
cobrança.

**Decisão.** Seis passos (reservar estoque → consumir cupom → cobrar →
confirmar pedido → limpar carrinho → avisar), cada um uma transação local com
seu log (`saga_steps`). Um **orquestrador** (`saga/orchestrator.ts`) conhece a
ordem, o papel de cada passo e as compensações.

A ordem segue o **custo de desfazer** (o desenho compensável → pivô →
retentável, de Garcia-Molina & Salem e do *Microservices Patterns* do Chris
Richardson):
- **Compensáveis primeiro** (estoque, cupom): desfazer é barato e interno, e é
  aqui que mora tudo que falha por regra. Cupom esgotado desfaz sem ter cobrado
  nada.
- **A cobrança é o pivô**, o ponto sem volta. Estornar custa taxa, demora e
  aparece na fatura do cliente — então ela só acontece quando o resto já está
  garantido. Recusada, desfaz cupom e estoque; aprovada, a saga **tem** que
  terminar.
- **Retentáveis depois** (confirmar, limpar carrinho, avisar): não desistem.
  Falha passageira tenta de novo; se não andar, a saga para em `halted`, com
  alerta crítico e botão "Retomar" no painel. Pedido pago nunca é estornado
  por erro de confirmação.

O registry recusa uma definição fora dessa forma. E cada saga grava a
**versão da definição** com que começou: mudar a ordem com saga em andamento
desalinharia a retomada, então a ordem nova é a v2 e a v1 continua registrada
até a última saga dela terminar.

**Alternativas.**
- *Transação distribuída (2PC/XA)*: o gateway de pagamento não participa, e o
  2PC segura bloqueio enquanto espera o mais lento — trava estoque por causa de
  um provedor lento.
- *Coreografia* (cada serviço reage a eventos dos outros): sem um dono do
  fluxo, a regra "o que desfazer se algo falhar depois de cobrar" fica
  espalhada em vários serviços. Com seis passos e compensação, orquestrar deixa
  o fluxo legível num arquivo só (`saga/definitions/checkout.ts`).
- *Tudo compensável, cobrança no meio* (a v1 deste projeto): cupom esgotado
  depois da cobrança virava cobrança + estorno, e qualquer erro depois do
  pagamento estornava um pedido legítimo.
- *Separar autorizar e capturar* (reservar o valor no cartão e capturar no
  fim): desfazer uma autorização é grátis, mas Pix e boleto não têm reserva, e
  o ganho não paga o dobro de integração numa demo.

**Preço.** O pedido não fecha dentro do request: a página mostra
"processando" por ~1–2 s e se atualiza sozinha. Mais código que um `BEGIN …
COMMIT`.

## 2. RabbitMQ como broker

**Problema.** Os passos da saga, os comandos de pagamento e os e-mails
precisam de entrega durável, retentativa com atraso e um lugar para o que
falhou de vez.

**Decisão.** RabbitMQ (CloudAMQP no deploy), com três filas lógicas: `saga`,
`payments`, `notifications`. Ack manual por mensagem, *publisher confirm* na
publicação, filas de espera para o atraso e DLQ por fila.

**Alternativas.**
- *Fila em tabela do Postgres* (`FOR UPDATE SKIP LOCKED`): foi a primeira
  versão. Funciona e é simples, mas mistura fila com banco transacional
  (polling constante, carga no banco que também atende a loja) e reinventa o
  que um broker já dá — atraso, DLQ, reentrega quando o consumidor morre. Foi
  substituída.
- *Kafka*: é um log de eventos para alto volume e *replay*. Aqui o problema é
  fila de trabalho: uma mensagem, um consumidor, ack individual, retry com
  atraso e DLQ. No Kafka isso exige tópicos extras e lógica de retry no
  consumidor, e operar um cluster custa mais.
- *SQS / Vercel Queues*: resolveriam, mas prendem ao provedor; o RabbitMQ roda
  igual no compose, no CI e em produção.

**Preço.** Mais uma peça para operar (no deploy, o plano grátis do CloudAMQP).

## 3. Outbox transacional

**Problema.** Gravar o pedido no banco e publicar a mensagem no broker são duas
escritas sem transação entre elas (*dual write*): commita o pedido e a
publicação falha — pedido que ninguém processa; ou publica e o commit falha —
mensagem de pedido que não existe.

**Decisão.** A mensagem é gravada na tabela `outbox` **no mesmo commit** do
fato de negócio. Um *relay* (`queue/relay.ts`) publica depois, com publisher
confirm, e só então marca `published_at`. Broker fora: a linha fica e o relay
tenta de novo com backoff.

**Alternativas.**
- *Publicar depois do commit, na mão*: o processo pode morrer entre o commit e
  a publicação.
- *CDC* (Debezium lendo o WAL): mais robusto em escala, mas é infraestrutura a
  mais para um volume que não precisa.

**Preço.** Pode haver **duplicata** (broker confirmou, o commit do
`published_at` falhou) — aceita de propósito, ver a decisão 5. Perda, não.

## 4. Retry por filas de espera e DLQ

**Problema.** Falha passageira (provedor fora, deadlock) merece nova tentativa,
com espera crescente. Falha de regra (sem estoque, cartão recusado) não: tentar
de novo não muda a regra.

**Decisão.**
- Erros têm taxonomia: `PermanentError` (regra → compensa ou DLQ na hora) e
  `RetryableError` (passageiro). Erro desconhecido conta como passageiro, de
  propósito.
- O atraso é uma **fila de espera por patamar** (1 s, 5 s, 30 s, 2 min) com
  `x-message-ttl`; quando vence, o *dead-letter exchange* devolve a mensagem à
  fila de trabalho com a tentativa + 1 no cabeçalho.
- Esgotou (3 por passo da saga, 3 no pagamento, 5 no e-mail): DLQ, com o
  último erro no cabeçalho. O painel admin mostra a DLQ e reprocessa.
- A tentativa é contada **antes** de executar: um crash no meio não vira retry
  infinito.

**Alternativas.**
- *TTL por mensagem numa fila só*: o RabbitMQ só expira a mensagem da cabeça
  da fila; uma de 2 min na frente seguraria uma de 1 s.
- *Plugin delayed-message*: é um plugin à parte, que teria que estar
  instalado no broker do compose, do CI e do gerenciado; as filas de espera
  resolvem com o RabbitMQ puro.
- *`setTimeout` no processo*: some se o processo morrer.

**Preço.** Quatro filas de espera por fila lógica; o atraso é arredondado para
o patamar de cima (nunca sai antes da hora).

## 5. Pelo menos uma vez + idempotência

**Problema.** "Exatamente uma vez" fim a fim não existe com broker + banco +
provedor externo: em algum ponto, ou se arrisca perder, ou se arrisca repetir.

**Decisão.** Entrega **pelo menos uma vez**, e todo consumidor é idempotente:
- passo da saga com log `completed` não roda de novo;
- cobrança com `payments.idempotency_key` (no banco e no `Idempotency-Key` do
  Stripe);
- e-mail `sent` não sai de novo;
- resposta do pagamento só é aplicada em passo `waiting`;
- um *lease* com prazo garante um executor por saga de cada vez, e a
  **reconciliação** (a cada 30 s) recria o avanço de saga parada há mais de
  1 min — nada fica parado para sempre.

**Preço.** Cada consumidor novo precisa ser pensado como idempotente.

## 6. Pagamentos em processo próprio

**Problema.** O pagamento é o único passo que fala com o mundo de fora, e o que
mais pode ficar lento ou fora do ar.

**Decisão.** Pagamentos roda em outro processo (`npm run worker:payments`),
consumindo a fila `payments`. A saga fala com ele **só por mensagem**: comando
com endereço de resposta, outbox dos dois lados, resposta aplicada uma vez. Fora
de `services/payments`, só o contrato (`contract.ts`) pode ser importado — o
teste de arquitetura falha se alguém importar a implementação.

Mensagem pode se perder no caminho (comando que morre na DLQ, resposta que
some), então o passo remoto tem **prazo**. Vencido, a saga pergunta ao serviço
(`payments.status`, uma consulta que só lê): já cobrou → conclui com a cobrança
que existe; não tem registro → reenvia a cobrança, com a mesma chave de
idempotência; ainda processando → espera. Sem resposta, o prazo dobra e, depois
de três consultas, vira alerta crítico — a saga nunca desfaz estoque e cupom
sem saber se o cliente foi cobrado.

**Por quê.** É o primeiro serviço que valeria extrair de verdade, e o contrato
por mensagem é o que permite separar o banco dele depois sem mexer na saga.

**Preço.** O Postgres ainda é compartilhado (cada serviço com suas tabelas). Na
demo da Vercel, por custo, pagamentos roda no mesmo runtime (decisão 8).

## 7. Monólito modular, fronteiras testadas

**Problema.** Microserviços resolvem times e escalas que este projeto não tem,
e cobram caro: rede entre serviços, deploy separado, observabilidade
distribuída.

**Decisão.** Um deploy, com fronteiras reais **verificadas por teste**
(`tests/unit/architecture.test.ts`): serviço não importa serviço (quem compõe é
a saga ou o caso de uso), serviço não depende do Next nem da saga, toda action
do admin começa checando papel e MFA.

Entre a borda e os serviços há uma **camada de aplicação** (`src/application`):
o caso de uso recebe a entrada já validada e compõe serviços — fechar a compra,
pedir orçamento, excluir a conta, ligar o MFA. A Server Action só lê o
formulário, chama o caso de uso e traduz o resultado; ela não escreve no banco
nem abre transação (o teste cobra). Formulário e assistente pedem orçamento pelo
**mesmo** caso de uso, então o chat não vira porta lateral sem limite.

**Preço.** A separação é disciplina de código, não de rede — mas é ela que
deixa cada serviço extraível sem reescrever regra.

## 8. Custo zero: worker embutido na Vercel

**Problema.** Um worker de pé precisa de um host pago ligado o tempo todo, e o
relay consultando a outbox a cada 500 ms não deixaria o banco serverless dormir
(a cota grátis do Neon acabaria no meio do mês). O objetivo da demo era
**custo zero**.

**Decisão.** Com `INLINE_WORKER=1`, ninguém fica de pé: quem deixa mensagem na
outbox (checkout, orçamento), a página do pedido em andamento e o painel de
orquestração publicam a outbox e drenam o RabbitMQ por *pull* depois de
responder (`after()`), e um cron diário é a rede de segurança. Os handlers são
os **mesmos** do worker de pé (`composition/worker.ts`) — a fila e a saga não
mudam.

A borda não sabe disso. O request do checkout **não executa passo nenhum**: o
caso de uso grava pedido, saga e mensagem e avisa `afterCommit`; quem liga esse
aviso ao dreno é a raiz de composição da borda web (`composition/web.ts`). Quem
executa a saga é sempre o consumidor da fila — em container ou no dreno.

**Preço.** Sem tráfego, um retry pode esperar o próximo request ou o cron. Com
tráfego real, o caminho é subir o `Dockerfile.worker` num container e desligar
a flag.

## 9. Sessão no banco, não JWT

**Problema.** Com JWT, sair só apagava o cookie: um token copiado continuava
valendo até expirar (7 dias). E o JWT não economizava nada — toda página já
consultava o banco para carregar o usuário.

**Decisão.** A sessão é uma linha (`sessions`). O cookie leva 32 bytes
aleatórios; o banco guarda só o **SHA-256** deles (quem lê o banco não tem o
que colar num cookie). Sair apaga a linha e o token morre na hora, em qualquer
lugar; dá para "sair dos outros aparelhos". Validade de 7 dias, sem renovação.
É o padrão de Rails, Django e Auth.js com banco.

**Preço.** Nenhum por request (a mesma consulta de antes, agora com join).

## 10. MFA (TOTP) obrigatório no painel

**Problema.** Senha do admin vazada abriria pedidos, produtos e cupons.

**Decisão.** Código de 6 dígitos de app autenticador (RFC 6238), obrigatório
para o admin:
- segredo cifrado no banco (AES-256-GCM, com o id da conta como dado
  autenticado — trocar o segredo de uma linha pelo de outra não abre);
- o mesmo código não entra duas vezes, nem em dois logins simultâneos
  (`UPDATE` condicional no passo de 30 s usado);
- 10 códigos de recuperação de uso único (só o hash fica no banco);
- limite de 5 tentativas a cada 15 min e 20 por dia, por conta.

O TOTP é o algoritmo do RFC em cima do HMAC do `node:crypto`, testado com os
vetores do próprio RFC. Só o admin tem MFA: a conta demo de cliente tem senha
pública, e quem ligasse MFA nela trancaria os outros visitantes.

**Alternativas.** SMS/e-mail (custo e SIM swap); WebAuthn/passkey (melhor,
mas mais fluxo de interface para um único admin).

## 11. O app conecta com menor privilégio

**Problema.** O app conectava como dono do banco: uma injeção de SQL ou a
`DATABASE_URL` vazada poderiam apagar tabela.

**Decisão.** O app usa o usuário `dystopia_app`, que só faz
`SELECT/INSERT/UPDATE/DELETE`. Migrations e seed usam a conexão do dono, que
nunca vai para o runtime. Os privilégios padrão fazem as tabelas das próximas
migrations já nascerem liberadas. No Neon, o papel tem que nascer por SQL:
papel criado pelo console entra no `neon_superuser`. Um teste conecta como o
papel e prova que ele **não** apaga, altera, esvazia nem cria tabela.

## 12. Fotos no Vercel Blob

**Problema.** O painel precisava trocar as fotos dos produtos, e uma função
serverless não grava arquivo no servidor.

**Decisão.** Vercel Blob (store público), atrás de uma interface com dois
lados: Blob em produção, pasta local no dev e nos testes — o mesmo esquema do
Stripe x simulado. A foto é validada **pelos primeiros bytes** (nome e tipo do
navegador não contam), SVG nunca entra, o nome do arquivo é gerado no servidor,
e o limite de 10 fotos por produto é garantido com a linha do produto travada.

**Alternativas.** URL de outro site (frágil, e cada host novo mexe na CSP);
imagem no Postgres (`bytea` no banco transacional); S3 próprio (mais conta e
configuração para o mesmo resultado). No plano grátis, o Blob **bloqueia em vez
de cobrar** ao passar do limite.

## 13. Limite de tentativas contado no Postgres

**Problema.** Em serverless, cada instância tem a própria memória: um contador
em memória seria dividido entre instâncias, e o limite não valeria.

**Decisão.** Contador no Postgres com `UPSERT` atômico
(`services/rate-limit`): login (10 / 15 min por IP), cadastro (5 / h por IP),
MFA (por conta), checkout, cupom, carrinho. O IP só vem de header escrito pela
borda da Vercel ou pelo proxy próprio — o cliente não forja um contador novo.

**Alternativa.** Redis (Upstash): mais rápido, mas mais um serviço para um
volume que o Postgres atende.

## 14. Busca com o full-text do Postgres

**Decisão.** Índice GIN sobre uma expressão (`to_tsvector` em português, sem
acento via `unaccent`), busca por prefixo e ordenação por relevância.

**Alternativa.** Elasticsearch, Algolia ou Meilisearch: melhores em escala e em
tolerância a erro de digitação, mas mais um serviço para um catálogo pequeno.

## 15. Testes contra infraestrutura real

**Decisão.** `node:test` + `tsx`, sem framework extra. Os testes de integração
rodam contra **Postgres e RabbitMQ de verdade** (o retry passa pelas filas de
espera reais, em milissegundos), e os de navegador (Playwright) contra a stack
inteira em containers, em desktop e celular, com acessibilidade (axe) e uma
compra pelo Stripe em modo de teste. O CI repete tudo e é obrigatório para
entrar na `main`.

**Por quê.** Mock de banco esconde exatamente o que mais quebra aqui:
concorrência (`SKIP LOCKED`, `UPDATE` condicional, lock de linha), transação e
reentrega. Exemplo real: um teste que falhava de vez em quando no CI revelou
que o relay comparava o horário gravado pelo Postgres (microssegundos) com o
relógio do Node (milissegundos) e pulava a mensagem gravada no mesmo
milissegundo — corrigido para usar o relógio do banco.

---

## Perguntas prováveis

**"Isso não é complexo demais para uma loja?"**
Para uma loja pequena de verdade, sim — uma transação e um provedor com
webhook bastariam. O projeto existe para mostrar o problema que aparece quando
o pagamento é externo e o pedido não pode ficar pela metade, e a resposta que
se dá a ele em produção. Cada peça tem um motivo escrito aqui, e o deploy custa
zero.

**"O que acontece se o RabbitMQ cair?"**
As mensagens ficam na outbox (no Postgres) e o relay tenta de novo com backoff
até o broker voltar. Nenhum pedido se perde; ele só demora.

**"E se o worker morrer no meio de um passo?"**
O passo e seu log commitam juntos, então ou o passo aconteceu inteiro ou não
aconteceu. A mensagem sem `ack` volta para a fila, o lease da saga vence, e a
reconciliação garante que sempre existe uma mensagem para terminar a saga.

**"E se der erro depois de cobrar?"**
Nada é estornado. Depois do pivô os passos só tentam de novo; se não andarem,
a saga para em `halted` e o painel mostra um alerta crítico com o botão
"Retomar", para depois de alguém corrigir a causa. Estornar um pedido pago por
causa de um erro de confirmação seria punir o cliente pelo bug da loja.

**"E se a mensagem do pagamento sumir?"**
O passo tem prazo de 2 minutos. Vencido, a reconciliação pergunta ao serviço de
pagamentos o que aconteceu com aquela chave: se cobrou, a saga conclui com a
cobrança que existe (a resposta é que tinha se perdido); se não há registro,
reenvia o comando — idempotente, então não cobra duas vezes.

**"Exactly-once?"**
Não existe fim a fim com broker + banco + provedor. O sistema garante "pelo
menos uma vez" e torna a repetição inofensiva (decisão 5).

**"Por que não Kafka?"**
Kafka é log de eventos para volume e replay; aqui o problema é fila de trabalho
com ack, atraso e DLQ, que o RabbitMQ entrega pronto (decisão 2).

**"Por que não microserviços?"**
Um deploy com fronteiras testadas dá o mesmo isolamento de regra sem o custo de
rede e operação. Pagamentos já é um processo separado por mensagem; o próximo
passo seria dar banco próprio a ele (decisões 6 e 7).

**"Como isso escala?"**
O gargalo seria o worker embutido: com tráfego, sobe-se o worker em container
(já existe o `Dockerfile.worker`) e várias instâncias consomem em paralelo — o
lease da saga e o `SKIP LOCKED` do relay já foram feitos para isso.

## O que eu faria com mais tempo ou tráfego

- Worker de pé em container e `INLINE_WORKER` desligado.
- Banco próprio para pagamentos, já que ele só conversa por mensagem.
- Cobrança real: webhooks do Stripe, 3D Secure e conciliação diária.
- Rastreamento distribuído (OpenTelemetry) do request até cada passo da saga.
- Passkeys (WebAuthn) no lugar do TOTP para o admin.
