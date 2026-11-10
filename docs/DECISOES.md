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
| 6 | [Pagamentos em processo próprio](#6-pagamentos-em-processo-próprio) | Processo e banco próprios; só conversa por mensagem |
| 7 | [Monólito modular, fronteiras testadas](#7-monólito-modular-fronteiras-testadas) | Serviços separados por regra, não por deploy; casos de uso numa camada própria |
| 8 | [Custo zero: worker embutido na Vercel](#8-custo-zero-worker-embutido-na-vercel) | Ninguém de pé; a fila é drenada depois do request |
| 9 | [Sessão no banco, não JWT](#9-sessão-no-banco-não-jwt) | Sair derruba o login na hora |
| 10 | [MFA no painel](#10-mfa-totp-obrigatório-no-painel) | Senha vazada sozinha não abre o admin |
| 11 | [Menor privilégio no banco](#11-o-app-conecta-com-menor-privilégio) | O app não consegue apagar tabela |
| 12 | [Fotos no Vercel Blob](#12-fotos-no-vercel-blob) | Arquivo fora do servidor, validado pelo conteúdo |
| 13 | [Limite de tentativas no Postgres](#13-limite-de-tentativas-contado-no-postgres) | Contador que vale entre instâncias serverless |
| 14 | [Busca com full-text do Postgres](#14-busca-com-o-full-text-do-postgres) | Sem serviço de busca à parte |
| 15 | [Testes contra infraestrutura real](#15-testes-contra-infraestrutura-real) | Postgres, RabbitMQ e Stripe de verdade, não mocks |
| 16 | [O cliente lê eventos do pedido, não a saga](#16-o-cliente-lê-eventos-do-pedido-não-a-saga) | Saga é detalhe de operação; o pedido conta a própria história |
| 17 | [Segundo ambiente na AWS, em Pulumi](#17-segundo-ambiente-na-aws-em-pulumi) | Containers descritos em código, sobem e descem pelo Actions |
| 18 | [Limite de login por conta, com aparelho conhecido](#18-limite-de-login-por-conta-com-aparelho-conhecido) | O ataque distribuído esbarra; o dono não fica trancado |
| 19 | [Recuperação de senha sem guardar o link](#19-recuperação-de-senha-sem-guardar-o-link) | O link é credencial: hash no banco e e-mail fora da outbox |
| 20 | [Senha nova conferida contra vazamentos](#20-senha-nova-conferida-contra-vazamentos) | Pwned Passwords por k-anonimato; a senha nunca sai do servidor |
| 21 | [Emblema 3D com three.js, contido e desktop-only](#21-emblema-3d-com-threejs-contido-e-desktop-only) | 3D no hero sem furar o LCP nem o mobile; fallback SVG |
| 22 | [Transições de página com View Transitions nativas](#22-transições-de-página-com-view-transitions-nativas) | React 19, zero biblioteca, sem violar a CSP |
| 23 | [Prettier sem reformatação em massa](#23-prettier-sem-reformatação-em-massa) | Config pronta; o diff gigante fica para um passo isolado |

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

**Uma outbox por banco, isoladas.** Com pagamentos em banco próprio (decisão
6), são duas outboxes, e o relay publica cada uma num compartimento separado
(*bulkhead*): se o banco de uma não responde, ela fica de fora por um backoff e
a outra segue publicando, e o dreno da fila segue consumindo. Veio de um
incidente: uma URL errada do banco de pagamentos fazia o relay lançar antes do
dreno, e **todo** checkout ficava em "processando", inclusive o que não
dependia de pagamentos. Hoje o mesmo erro vira um alerta crítico no painel
("Banco da outbox pagamentos sem resposta") e o resto da fila anda.

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
consumindo a fila `payments`, **com banco próprio** (`PAYMENTS_DATABASE_URL`,
migrations próprias em `drizzle-payments/`, outbox própria). A saga fala com
ele **só por mensagem**: comando com endereço de resposta, resposta aplicada
uma vez. Fora de `services/payments`, só o contrato (`contract.ts`) pode ser
importado — e o contrato não importa nada, nem o schema de ninguém. O teste de
arquitetura falha se alguém importar a implementação ou o banco dele.

A fronteira é de **dados**, não só de processo: a loja não lê a tabela de
pagamentos. A resposta da cobrança traz o resumo (meio, provedor, transação,
quando) e o pedido guarda isso ao ser confirmado — é o que a página do
cliente, o painel, a exportação LGPD e o assistente mostram. O processo de
pagamentos nem tem a URL do banco da loja (no compose ela vai vazia de
propósito).

O modo demonstração também saiu do contrato: em vez de um campo `mode` no
comando, ele virou **token de teste** do provedor simulado (`sim_decline`,
`sim_flaky_once`…), como os cartões de teste do Stripe — e pagamentos só aceita
esses tokens com o modo demonstração ligado no processo dele.

Mensagem pode se perder no caminho (comando que morre na DLQ, resposta que
some), então o passo remoto tem **prazo**. Vencido, a saga pergunta ao serviço
(`payments.status`, uma consulta que só lê): já cobrou → conclui com a cobrança
que existe; não tem registro → reenvia a cobrança, com a mesma chave de
idempotência; ainda processando → espera. Sem resposta, o prazo dobra e, depois
de três consultas, vira alerta crítico — a saga nunca desfaz estoque e cupom
sem saber se o cliente foi cobrado.

**Por quê.** É o primeiro serviço que valeria extrair de verdade, e o contrato
por mensagem é o que permite separar o banco dele depois sem mexer na saga.

**Preço.** Dois bancos para migrar e liberar, e uma migração de dados de uma
vez: os pagamentos da tabela antiga, no banco da loja, foram copiados para o
banco novo e, com as contagens conferidas, a tabela foi apagada. Na
demo da Vercel, por custo, pagamentos roda no mesmo runtime (decisão 8) — mas
cada um falando com o próprio banco. Exclusão de conta não apaga mais a
cobrança: ela fica no banco de pagamentos como registro financeiro sem dado
pessoal.

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
tráfego real, o caminho é subir o `docker/Dockerfile.worker` num container e desligar
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
MFA (por conta), checkout, cupom, carrinho. O login também tem limite por
conta (decisão 18). O IP só vem de header escrito pela borda da Vercel ou pelo
proxy próprio — o cliente não forja um contador novo.

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

## 16. O cliente lê eventos do pedido, não a saga

**Problema.** A página do pedido importava o orquestrador e mostrava os passos
da saga pelo nome interno ("reserve-stock", "consume-coupon"). Trocar a ordem
dos passos, separar um passo em dois ou mudar a saga de versão mudaria o que o
cliente vê — e o motivo do cancelamento era tirado de um texto de erro da saga.

**Decisão.** O pedido tem **eventos de domínio** próprios (`order_events`):
recebido, pago, em separação, despachado, entregue, cancelado (com o código do
motivo) e reembolsado. Quem grava é o serviço de pedidos, na mesma transação de
cada mudança de status — venha ela da saga ou do painel. A página do cliente lê
só isso (`OrderTimeline`); a saga aparece só no painel de operação. Um teste de
arquitetura impede a borda do cliente de importar a saga.

**Preço.** Uma tabela a mais e uma escrita a mais por mudança de status. Os
pedidos antigos ganharam o histórico possível na migration (recebido + status
atual, e o motivo do cancelamento tirado da saga).

---

## 17. Segundo ambiente na AWS, em Pulumi

**Problema.** A Vercel é ótima para o Next, mas esconde a infraestrutura. Por
isso faltava mostrar a mesma aplicação numa arquitetura de containers
descrita em código, sem gastar nada.

**Decisão.** Um segundo ambiente na AWS, em Pulumi (TypeScript, `infra/`), que
sobe e desce pelo GitHub Actions com OIDC (nenhuma chave da AWS no GitHub):

- web, worker e payments como serviços do ECS Fargate (os workers em Spot),
  atrás de CloudFront e de um load balancer **interno**, que o CloudFront
  alcança pela rede da AWS (VPC origin) e ninguém alcança pela internet;
- banco no Neon e fila no CloudAMQP: o modelo híbrido, porque RDS e Amazon MQ
  gastariam os créditos sozinhos;
- a migração roda dentro do `pulumi up`, antes dos serviços.

Detalhes, custo e passo a passo em [`AWS.md`](AWS.md).

**Alternativas.**
- *EC2 com docker compose*: mais barato, mas é um servidor para manter.
- *Tudo gerenciado* (RDS + Amazon MQ + NAT): é o desenho de quando houver
  orçamento.
- *Terraform*: equivalente. O Pulumi deixa a infra na mesma linguagem do app
  e permite testar o programa com mocks.

**Preço.** Só é de graça numa conta no plano Free (créditos, 6 meses). O normal
é subir para mostrar e derrubar depois. Fotos do painel ficam no disco da
tarefa, e o trecho do CloudFront até o load balancer é HTTP até haver domínio
próprio.

## 18. Limite de login por conta, com aparelho conhecido

**Problema.** O limite por IP (decisão 13) não segura um ataque distribuído:
com muitos IPs, cada um tenta poucas vezes a mesma conta. Limitar por conta
resolve, mas abre o problema oposto: quem sabe o e-mail de alguém erra a senha
de propósito e tranca a conta do dono.

**Decisão.** Os dois limites (`application/login.ts`), com o padrão "device
cookies" da OWASP para o segundo:

- por IP, como antes (10 / 15 min);
- por conta, em aparelho desconhecido: 10 falhas / 15 min e 50 / dia. A janela
  diária é a que faz um ataque distribuído levar anos;
- no navegador onde o dono já entrou (cookie `known_device`, registro em
  `services/known-devices`), as falhas contam num contador do aparelho. O
  ataque tranca os aparelhos desconhecidos, não o do dono.

Detalhes que fecham os buracos:
- cada tentativa reserva a vaga antes de conferir a senha, e o login certo
  devolve a dele. Assim só falha conta, e tentativas simultâneas não passam do
  limite;
- e-mail sem conta é contado igual, para a resposta não revelar quais existem;
- a chave do contador leva o hash do e-mail, não o e-mail;
- o cookie não autentica nada: só escolhe o contador. Ele tem o mesmo desenho
  da sessão (32 bytes aleatórios no cookie, SHA-256 no banco), dura 180 dias
  sem uso e some com a conta;
- a conta demo fica fora do limite por conta: a senha dela está publicada, não
  há o que proteger, e trancá-la só atrapalharia quem visita.

**Alternativas.**
- *CAPTCHA depois de N falhas*: segura robô sem trancar ninguém, mas é mais um
  serviço externo (e script de terceiro na CSP) para uma loja de demonstração.
- *Atraso crescente por conta*: em serverless, segurar a resposta custa tempo
  de função, e o atacante escolhe quanto.
- *Cookie assinado (HMAC) em vez de tabela*: dispensa a tabela, mas exige um
  segredo novo e não dá para revogar. A tabela segue o mesmo caminho da sessão
  (decisão 9).

**Preço.** Quem entra de um aparelho novo durante um ataque à própria conta
espera a janela vencer, entra pelo aparelho de sempre ou redefine a senha
pelo e-mail (decisão 19), o que torna aquele navegador conhecido.

## 19. Recuperação de senha sem guardar o link

**Problema.** Sem "esqueci minha senha", quem esquecia perdia a conta. Mas o
link de redefinição é uma credencial: quem o tiver troca a senha. O caminho
normal de e-mail do projeto (decisão 3) grava o corpo da mensagem na tabela
`notifications` antes de enviar — com o link dentro, quem lesse o banco ou
o painel tomaria a conta.

**Decisão.** O desenho da OWASP (Forgot Password Cheat Sheet), em
`application/password-reset.ts`:

- a tela responde a mesma coisa exista a conta ou não, e procurar a conta e
  mandar o e-mail acontece depois da resposta (`after()`), então nem o tempo
  de resposta revela quais e-mails existem;
- o link leva 32 bytes aleatórios e o banco guarda só o SHA-256; vale 30
  minutos e uma vez só (gastar é `DELETE ... RETURNING`: dois envios
  simultâneos não trocam a senha duas vezes); pedir de novo invalida o
  anterior;
- **este e-mail não passa pela outbox**: sai direto pelo provedor
  (`notifications/direct.ts`), sem ser gravado;
- trocar a senha derruba todos os logins abertos e torna o navegador
  conhecido (decisão 18). Não entra sozinho: a pessoa faz login, com o código
  do autenticador se tiver;
- limite por IP e por e-mail (ninguém lota a caixa de alguém), e a página do
  link manda `Referrer-Policy: no-referrer`;
- a conta demo não troca de senha: ela está publicada.

**Alternativas.**
- *Pela outbox, como os outros e-mails*: ganharia retry, mas gravaria o
  link. Sem retry, se o provedor falhar, a pessoa pede outro.
- *Código de 6 dígitos em vez de link*: mais fácil de digitar no celular, mas
  é adivinhável e exigiria outro limite de tentativas.
- *Entrar sozinho depois de trocar*: pularia o segundo fator do admin.

**Preço.** Sem domínio próprio, o Resend fica no modo sandbox e todo e-mail
vai para a caixa da loja: em produção o link chega lá, não ao cliente. Serve
para demonstrar; para valer, é registrar um domínio e ligar
`EMAIL_DELIVER_TO_RECIPIENTS=1`.

## 20. Senha nova conferida contra vazamentos

**Problema.** O cadastro aceitava `12345678` e `password`, que aparecem
milhões de vezes em vazamentos. Quem ataca começa por essas listas, e o
limite de tentativas não ajuda se a primeira tentativa já acerta. Além disso,
o bcrypt só lê os primeiros 72 bytes: duas senhas longas com o mesmo começo
valiam a mesma coisa.

**Decisão.** Senha nova (cadastro e redefinição) tem até 72 bytes e é
conferida no Pwned Passwords, do Have I Been Pwned (NIST SP 800-63B,
3.1.1.2; OWASP ASVS 5.0, 6.2.12):

- **k-anonimato:** só os 5 primeiros caracteres do SHA-1 saem do servidor; a
  API devolve todos os sufixos que começam com eles (com padding), e a
  comparação é feita aqui. A senha e o hash inteiro nunca saem;
- se a API não responder em 2 segundos, a senha passa e o log avisa;
- a consulta só acontece depois de um filtro (limite por IP no cadastro, link
  válido na redefinição), para o site não virar proxy de consulta em massa;
- o login segue aceitando senha longa: quem cadastrou antes do teto entra.

**Alternativas.**
- *Lista local das senhas mais comuns*: nenhuma chamada de fora, mas umas
  dez mil senhas contra mais de 900 milhões.
- *Regra de composição (maiúscula, número, símbolo)*: o NIST desaconselha;
  vira `Senha@123`, que está em toda lista.
- *Falhar fechado quando a API cai*: mais rígido, mas o cadastro pararia
  junto com um serviço de terceiro.

**Preço.** Uma chamada externa no cadastro (rápida, com cache da
Cloudflare) e um operador a mais na política de privacidade. O que vai para
lá (5 caracteres de um hash) não identifica nada.

A revisão de segurança inteira, com os outros achados, está em
[`SEGURANCA.md`](SEGURANCA.md).

## 21. Emblema 3D com three.js, contido e desktop-only

**Problema.** O hero da home é a primeira tela de um projeto de portfólio e
precisa ter acabamento de produto. O emblema "The Gate" é a marca da loja; uma
versão em relevo, que reage ao ponteiro, é o tipo de detalhe que separa "site
de estudo" de "site de mercado". Mas 3D na web tem três riscos conhecidos: pesa
no bundle, briga com o LCP e pode virar enfeite neon que atropela a identidade.

**Decisão.** Um emblema em 3D (`src/components/hero/GateScene.tsx`) com
**three.js** e **`@react-three/fiber`**, exibido só no hero, com três cercas:

- **Fiel à identidade, não um enfeite.** Monocromático (folhas em bone, aro em
  steel) sobre obsidian, matéria fosca, **sem glow, sem cor de luz, sem reflexo
  de ambiente** (`flat` tone mapping, só luz branca direcional). A geometria é a
  mesma do emblema 2D e o portão **nasce fechado e não abre** — o único
  movimento é o parallax mecânico amortecido do ponteiro ("entra, para"). O
  vermelho fica reservado à ação, então o relevo é neutro, como o SVG.
- **Progressivo e contido** (`HeroEmblem.tsx`). Entra por `next/dynamic` com
  `ssr: false` — fora do HTML inicial, não disputa o LCP — e só monta no
  **desktop (lg+) com WebGL e sem `prefers-reduced-motion`**. Fora disso fica o
  `EmblemSting` (SVG), que também é o fallback de carregamento. **No celular o
  chunk pesado (three ≈ 232 KB gzip) nem é baixado.**
- **Custo ocioso zero.** `frameloop` sob demanda (renderiza a entrada, assenta e
  para) e pausa fora da tela por `IntersectionObserver`.

**Alternativas.**
- *Imagem/vídeo pré-renderizado do emblema*: barato, mas estático — perde o
  parallax e a sensação de objeto, que é o ponto.
- *3D em toda viewport, inclusive celular*: o custo de GPU e o LCP no mobile não
  se pagam numa peça decorativa; por isso o corte em desktop-only.
- *WebGL direto, sem react-three/fiber*: menos uma dependência, mas muito mais
  código imperativo de cena/loop para o mesmo resultado; r3f mantém a cena
  declarativa e descartável.

**Preço.** Duas dependências novas (`three`, `@react-three/fiber`; `@types/three`
em dev) e **~2 pontos de Lighthouse Perf / +0,5 s de LCP no desktop** (medido
com render por software, o pior caso; em GPU real é menos — e ainda "bom",
< 2,5 s). O bundle inicial e o mobile ficam intactos, porque o 3D é carregado
sob demanda só onde aparece.

## 22. Transições de página com View Transitions nativas

**Problema.** Navegar entre as páginas da loja (vitrine → produto → carrinho →
checkout) sem transição corta seco demais para o acabamento que o resto da
vitrine tem. A reação usual seria uma biblioteca de animação (framer-motion e
afins).

**Decisão.** O `<ViewTransition>` **nativo do React 19** (export estável neste
Next 16), num componente fino (`src/components/PageTransition.tsx`) que envolve
o conteúdo de cada página. Na navegação, o conteúdo antigo sai com um corte seco
e o novo assenta no lugar; o cabeçalho e o rodapé ficam fixos (a CSS zera a
animação do `root`). O movimento **some inteiro em `prefers-reduced-motion`**.

**Alternativas.**
- *`framer-motion` (ou similar)*: peso de biblioteca a mais e, pior, risco de
  injetar `<script>`/`<style>` inline que violem a **CSP de `nonce` +
  `strict-dynamic`** do projeto. As View Transitions são do navegador — nenhum
  inline, nada a liberar na CSP.
- *Sem transição*: honesto, mas abaixo do acabamento do resto da vitrine.

**Preço.** Zero dependência. O recorte do movimento mora em
`globals.css` (pseudo-elementos `::view-transition-*`), que a regra global de
`prefers-reduced-motion` não alcança sozinha, então o "desligar" é refeito ali à
mão — um detalhe a lembrar ao mexer na animação.

## 23. Prettier sem reformatação em massa

**Problema.** O projeto não tinha formatador declarado: o estilo era mantido no
olho, e um colaborador novo (ou outra IDE) não tinha como reproduzi-lo. O
reflexo seria rodar `prettier --write .` e commitar — mas isso reformata ~200
arquivos (linhas que o autor quebrou à mão e o Prettier recolheria), um diff
ingovernável que poluiria todo o trabalho em paralelo.

**Decisão.** Adotar o **Prettier** com a config **calibrada para casar com o
estilo que o código já usa** (`.prettierrc.json`: `printWidth: 120`, aspas
duplas, `trailingComma: all`, `semi`, `tabWidth: 2`) — módulos curtos e limpos
(`money.ts`, `pagination.ts`, `shipping.ts`, `catalog-rules.ts`) saem
**byte-idênticos** do Prettier. Junto vêm `.editorconfig` (espaço/LF/charset
entre editores), `.prettierignore` (protege o gerado — `drizzle/`,
`drizzle-payments/`, `*.md` com quebra manual, `infra/`, `public/`,
`package-lock.json`) e os scripts `format` / `format:check`. **A reformatação em
massa ficou de propósito como passo seguinte, isolado num commit só** (`npm run
format`).

**Alternativas.**
- *`prettier --write .` agora*: o diff gigante atravessaria os PRs em andamento.
- *Não ter formatador*: mantém o estilo refém da disciplina de quem escreve;
  sem rede para contribuição.
- *Flags de tipo mais estritas junto* (`exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`): avaliadas e **adiadas** — 29 e ~309 erros
  respectivamente; cada uma é um PR de endurecimento próprio (ver o backlog
  P1–P6 em [`ARQUITETURA.md`](ARQUITETURA.md)).

**Preço.** Uma dependência de dev e uma assimetria temporária: a config está
pronta, mas o código só fica 100% dentro dela quando o commit de reformatação em
massa rodar.

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
rede e operação. Pagamentos já é separado de verdade — processo, banco e
outbox próprios, conversa só por mensagem (decisões 6 e 7); extrair outro
serviço segue o mesmo caminho.

**"Como isso escala?"**
O gargalo seria o worker embutido: com tráfego, sobe-se o worker em container
(já existe o `docker/Dockerfile.worker`) e várias instâncias consomem em paralelo — o
lease da saga e o `SKIP LOCKED` do relay já foram feitos para isso.

## O que eu faria com mais tempo ou tráfego

- Worker de pé em container e `INLINE_WORKER` desligado.
- Cobrança real: webhooks do Stripe, 3D Secure e conciliação diária.
- Rastreamento distribuído (OpenTelemetry) do request até cada passo da saga.
- Passkeys (WebAuthn) no lugar do TOTP para o admin.
