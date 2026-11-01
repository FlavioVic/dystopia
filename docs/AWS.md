# Ambiente AWS (Pulumi)

O DYSTOPIA roda em produção na Vercel. Este é o **segundo ambiente**, na AWS,
descrito em código com [Pulumi](https://www.pulumi.com/) (TypeScript, pasta
`infra/`). Ele sobe e desce com um clique no GitHub Actions. A ideia é mostrar a
mesma aplicação numa arquitetura de containers, sem depender da plataforma
serverless.

**Custo:** zero, por decisão. A conta da AWS fica no **plano Free**: contas
criadas depois de 15/07/2025 ganham US$ 100 em créditos, mais até US$ 100 por
atividades. Esse plano não cobra nada e vale por 6 meses ou até os créditos
acabarem. Tudo aqui foi escolhido para gastar o mínimo de crédito, e o normal
é **subir para mostrar e derrubar depois**.

## Arquitetura

```
navegador ──HTTPS──▶ CloudFront ──HTTP──▶ load balancer ──▶ web (Fargate)
                     (cache do _next/static)   │ só aceita o CloudFront
                                               ▼
                                       VPC, 2 sub-redes públicas, sem NAT
                                               │
                     worker (Fargate Spot) ────┤ saga + e-mail + relay da outbox
                     payments (Fargate Spot) ──┤ só a fila de pagamentos
                                               ▼
                           Neon (Postgres, projeto próprio)
                           CloudAMQP (RabbitMQ, prefixo dystopia_aws)
```

Fica no modelo **híbrido**: os três processos do app rodam na AWS, mas o banco
(Neon) e a fila (CloudAMQP) continuam nos planos gratuitos de fora. Postgres
gerenciado (RDS) e RabbitMQ gerenciado (Amazon MQ) gastariam os créditos sozinhos.

São dois programas Pulumi:

| | `infra/bootstrap` (a **base**) | `infra/app` (o **ambiente**) |
|---|---|---|
| O quê | acesso do GitHub (OIDC), registros de imagem (ECR), segredos gerados, alerta de gasto | rede, load balancer, CloudFront, cluster ECS, 3 serviços, migração |
| Quem roda | você, **uma vez**, da sua máquina | o workflow `AWS`, a cada "subir" e "derrubar" |
| Cobra por hora? | não | sim (dos créditos), enquanto estiver de pé |
| Quando derruba | fica | sai inteiro |

## O que custa (dos créditos)

Valores aproximados em us-east-1, com o ambiente **de pé**:

| Peça | Por hora |
|---|---|
| web (Fargate, 0,5 vCPU / 1 GB, ARM) | ~US$ 0,02 |
| worker + payments (Fargate **Spot**, 0,25 vCPU / 0,5 GB, ARM) | ~US$ 0,006 |
| load balancer | ~US$ 0,03 |
| IPv4 públicos (tarefas + load balancer) | ~US$ 0,025 |
| **Total** | **~US$ 0,08/h** (≈ US$ 55/mês se ficar ligado direto) |

CloudFront, logs (7 dias), Parameter Store e o tráfego de uma demonstração
ficam dentro das camadas gratuitas. O ECR cobra centavos pelas imagens
guardadas (só as 3 últimas de cada uma).

A base cria um **alerta de gasto** (padrão: US$ 20/mês) sobre o custo **bruto**,
antes dos créditos. No plano Free o custo líquido é sempre zero, então o
alerta mostra quanto dos créditos está indo embora.

### Limites que vêm junto

- **Neon:** o projeto gratuito tem 100 horas de compute por mês. Com os
  workers sempre ligados o banco não dorme, e a cota acaba lá pelo 16º dia.
  Aí o ambiente AWS para até o mês virar. A produção não sente, porque está
  em outro projeto Neon.
- **Fotos enviadas pelo painel:** ficam no disco da tarefa e somem no próximo
  deploy. As fotos do catálogo vêm da imagem e não somem.
- **CloudFront → load balancer em HTTP:** quem acessa usa HTTPS, mas HTTPS até
  a origem exige domínio próprio com certificado (veja "Próximos passos").
- **A conta fecha** quando o plano Free termina (6 meses ou fim dos créditos).
  O ambiente some com ela; a Vercel continua.

## Montar uma vez (o que só você faz)

### 1. Conta da AWS no plano Free

Crie em <https://aws.amazon.com/free> e escolha o **Free plan**. Só tem direito
quem nunca teve conta na AWS, e cartão e e-mail não podem ter sido usados lá.

- Ative MFA no usuário raiz.
- Em **IAM → Users**, crie um usuário `admin` com `AdministratorAccess`.
- Crie uma **access key** para ele. Ela serve só para o passo 4, e você apaga
  logo depois.

### 2. Pulumi (onde fica o estado da infraestrutura)

- Crie a conta em <https://app.pulumi.com>, que é gratuita para uma pessoa
  (dá para entrar com o GitHub).
- Em **Personal access tokens**, gere um token.

Instale a CLI no WSL:

```bash
curl -fsSL https://get.pulumi.com | sh   # depois abra um terminal novo
pulumi login                              # cola o token
```

### 3. Banco do ambiente AWS: projeto Neon próprio

O ambiente AWS não pode usar o banco da produção, por dois motivos: os
workers das duas plataformas disputariam a mesma outbox, e a cota de compute
é por projeto.

```bash
neon projects create --name dystopia-aws --region-id aws-us-east-1
neon connection-string --project-id <id-do-projeto-novo> --database-name neondb --pooled false
```

Guarde essa string (é a do **dono**). O banco de pagamentos e o usuário
`dystopia_app` são criados pela migração no primeiro "subir".

### 4. A base (`infra/bootstrap`)

No seu terminal (não no chat), com a access key do passo 1:

```bash
cd infra && npm ci && cd bootstrap
read -rs AWS_ACCESS_KEY_ID && export AWS_ACCESS_KEY_ID          # cola e Enter
read -rs AWS_SECRET_ACCESS_KEY && export AWS_SECRET_ACCESS_KEY  # cola e Enter
pulumi stack init aws
pulumi config set budgetEmail voce@exemplo.com      # quem recebe o alerta de gasto
pulumi up                                           # confira o plano e confirme
pulumi stack output deployRoleArn                   # vai para o GitHub (passo 5)
```

Depois apague a access key no console (IAM → Users → admin → Security
credentials). Daqui em diante, só o GitHub entra na conta, por OIDC.

### 5. GitHub (Settings → Secrets and variables → Actions)

| Onde | Nome | Valor |
|---|---|---|
| Variables | `AWS_ROLE_ARN` | a saída `deployRoleArn` do passo 4 |
| Secrets | `PULUMI_ACCESS_TOKEN` | o token do passo 2 |
| Secrets | `AWS_NEON_OWNER_URL` | a string do passo 3 |
| Secrets | `AWS_RABBITMQ_URL` | a URL do CloudAMQP (a mesma da produção; o prefixo `dystopia_aws` separa as filas) |

`STRIPE_PUBLISHABLE_KEY` e `STRIPE_SECRET_KEY` já existem (são as de teste da
CI) e o ambiente AWS usa as mesmas.

### 6. Primeiro "subir"

Actions → **AWS** → Run workflow → `subir`, com **popular** marcado.

O workflow monta as imagens (ARM), roda a migração, popula o banco e sobe os
serviços. Leva uns 15 minutos, porque o CloudFront demora a propagar. O
endereço `https://….cloudfront.net` aparece no resumo do job.

- **Admin:** e-mail do seed. A senha está em `cd infra/bootstrap && pulumi stack output seedAdminPassword --show-secrets`.
  No primeiro login o painel pede para cadastrar o autenticador (MFA).
- **Cliente demo:** `cliente@dystopia.dev` / `cliente123`.

## Dia a dia

- **Subir:** Actions → AWS → `subir` (sem popular, porque popular apaga os
  dados). A migração roda antes dos serviços. Se ela falhar, nada sobe.
- **Derrubar:** Actions → AWS → `derrubar`. Some tudo o que cobra por hora.
  Ficam a base, as imagens e o banco no Neon. O próximo "subir" volta com os
  mesmos dados.
- **Logs:** CloudWatch → Log groups → `/dystopia/aws` (um fluxo por processo).

## Decisões

| Escolha | Por quê | Alternativa que ficou de fora |
|---|---|---|
| ECS Fargate | Containers sem servidor para administrar. Usa os mesmos Dockerfiles do docker-compose. | EC2 com docker compose: mais barato, mas é um servidor para manter. EKS: cobra o control plane. |
| Híbrido (Neon + CloudAMQP) | Custo zero de verdade | RDS + Amazon MQ: gastam os créditos em poucas semanas |
| Sub-redes públicas, sem NAT | NAT gateway cobra por hora (~US$ 33/mês). A entrada fica fechada pelos security groups. | Sub-redes privadas + NAT ou VPC endpoints, o desenho de quando houver orçamento |
| Load balancer só aceita o CloudFront | Ninguém chega no app sem passar pelo CloudFront, então o `CloudFront-Viewer-Address` (IP do cliente para o limite de tentativas) não é forjável | Header secreto entre CloudFront e load balancer (dá para somar depois) |
| CloudFront na frente | HTTPS sem domínio próprio e cache dos estáticos | Domínio + certificado (ACM) direto no load balancer |
| Workers em Fargate Spot | ~70% mais barato. Se a AWS interromper a tarefa, o broker reentrega o que ficou sem ack. | Fargate normal (é o que o web usa) |
| ARM (Graviton) | ~20% mais barato | x86 |
| Parameter Store (SecureString) | Gratuito. O valor não aparece na definição da tarefa. | Secrets Manager: cobra por segredo por mês |
| Migração dentro do `pulumi up` (`command.local.Command`) | Código novo nunca sobe antes do schema dele | Migração num passo separado do workflow, que fica fácil de esquecer ou de rodar fora de ordem |
| OIDC GitHub → AWS | Nenhuma chave da AWS guardada no GitHub. A role só aceita a `main`. | Access key em secret do GitHub |
| Segredos gerados na base | Sobrevivem ao "derrubar", como o banco. Se fossem gerados a cada "subir", o banco deixaria de abrir. | Gerar no ambiente |

## Verificação sem nuvem

`infra/tests/app.test.ts` roda o programa do ambiente com os mocks do Pulumi.
Nada vai para a AWS, e o teste confere o que seria criado:

- o load balancer só aceita o CloudFront;
- nenhum segredo em texto na definição das tarefas;
- pagamentos sem o banco da loja;
- sem NAT gateway, workers em Spot, tudo em ARM.

Roda na CI de todo PR (`cd infra && npm test`).

## Próximos passos

- Domínio próprio: certificado ACM, HTTPS do CloudFront até o load balancer e
  nome bonito no lugar do `cloudfront.net`.
- Role de deploy com o mínimo de cada serviço, no lugar do PowerUser (a conta
  é dedicada ao projeto, mas dá para fechar mais).
- Fotos do painel no S3 (hoje vão para o disco da tarefa).
- Autoscaling do web por CPU ou requests; hoje é uma tarefa.
