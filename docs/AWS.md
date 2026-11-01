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
navegador ──HTTPS──▶ CloudFront ─ ─ VPC origin (rede privada da AWS) ─ ─┐
                     (cache do _next/static)                           │
┌─ VPC ────────────────────────────────────────────────────────────────▼──┐
│ sub-redes PRIVADAS (sem rota p/ internet): load balancer INTERNO        │
│        │ só aceita o security group do CloudFront                       │
│        ▼                                                                │
│ sub-redes PÚBLICAS (só saída; nenhuma porta aberta para fora):          │
│   web (Fargate) ◀── só o load balancer entra                            │
│   worker (Fargate Spot)   saga + e-mail + relay da outbox               │
│   payments (Fargate Spot) só a fila de pagamentos                       │
└────────┬────────────────────────────────────────────────────────────────┘
         ▼ TLS, pela internet
   Neon (Postgres, projeto próprio) · CloudAMQP (RabbitMQ, prefixo dystopia_aws)
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
| load balancer (interno: sem IP público) | ~US$ 0,03 |
| IPv4 públicos (as 3 tarefas) | ~US$ 0,015 |
| **Total** | **~US$ 0,07/h** (≈ US$ 50/mês se ficar ligado direto) |

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
- **Sem domínio próprio:** quem acessa usa HTTPS, mas com o certificado
  padrão `*.cloudfront.net`, que a AWS fixa na política TLSv1 (aceita TLS
  1.0/1.1). O trecho CloudFront → load balancer é HTTP, só que **dentro da
  rede privada da AWS** (VPC origin), e não pela internet. Os dois se
  resolvem com domínio próprio (veja "Próximos passos").
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
| Tarefas em sub-rede pública, sem NAT | Elas precisam **sair** para Neon, CloudAMQP, Stripe e ECR, e o NAT gateway cobra por hora (~US$ 33/mês). O IP público serve só para sair: nenhum security group delas aceita conexão de fora, e o web só aceita o load balancer. | Sub-redes privadas + NAT (o padrão de produção quando há orçamento). VPC endpoints não resolvem, porque Neon e CloudAMQP estão fora da AWS. |
| Load balancer **interno** + CloudFront **VPC origin** | O load balancer fica em sub-rede privada, sem endereço na internet. O CloudFront chega nele pela rede da AWS, e só o security group do CloudFront entra. Ninguém forja o `CloudFront-Viewer-Address` (IP do cliente para o limite de tentativas) e senha ou cookie não passa em claro pela internet. Sem custo adicional. | Load balancer público liberado para a lista de IPs do CloudFront: o tráfego passaria pela internet em HTTP |
| CloudFront na frente | HTTPS sem domínio próprio e cache dos estáticos | Domínio + certificado (ACM) direto no load balancer |
| Workers em Fargate Spot | ~70% mais barato. Se a AWS interromper a tarefa, o broker reentrega o que ficou sem ack. | Fargate normal (é o que o web usa) |
| ARM (Graviton) | ~20% mais barato | x86 |
| Parameter Store (SecureString) | Gratuito. O valor não aparece na definição da tarefa. | Secrets Manager: cobra por segredo por mês |
| Migração dentro do `pulumi up` (`command.local.Command`) | Código novo nunca sobe antes do schema dele | Migração num passo separado do workflow, que fica fácil de esquecer ou de rodar fora de ordem |
| OIDC GitHub → AWS | Nenhuma chave da AWS guardada no GitHub. A role só aceita a `main` deste repositório, por igualdade exata e pelos **ids imutáveis** do dono e do repo (formato do GitHub para repositórios criados depois de 15/07/2026): renomear ou recriar um repo com o mesmo nome não herda o acesso. | Access key em secret do GitHub. Condição com curinga (`StringLike`). |
| Role de deploy com o mínimo | Só os serviços do ambiente; IAM, ECR e Parameter Store presos aos recursos `dystopia-*`. O deploy não sobe EC2, não cria banco nem usuário. | `PowerUserAccess` (era o rascunho; amplo demais) |
| Segredos gerados na base | Sobrevivem ao "derrubar", como o banco. Se fossem gerados a cada "subir", o banco deixaria de abrir. | Gerar no ambiente |

## Revisão de segurança

O desenho foi conferido contra a documentação da AWS e do GitHub:

- **Porta de entrada única.** O CloudFront é o único caminho até o app:
  [VPC origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html)
  com o load balancer em sub-rede privada, liberado só para o security group
  que o CloudFront cria (a opção "mais restritiva" da documentação).
- **OIDC.** Igualdade exata em `aud` e `sub`, no
  [formato com ids imutáveis](https://github.blog/changelog/2026-04-23-immutable-subject-claims-for-github-actions-oidc-tokens/).
  Esse formato é o que este repositório usa: com o antigo, a AWS recusaria o deploy.
- **Menor privilégio:**
  - role de deploy só com os serviços do ambiente;
  - role de execução das tarefas lê só os parâmetros dela;
  - role da tarefa sem permissão nenhuma, porque o app não chama a AWS;
  - containers sem root (`USER node`);
  - pagamentos sem o banco da loja;
  - app no banco como `dystopia_app`, só leitura e escrita de linha.
- **Segredos:** em SecureString, lidos pelo ECS na hora de subir a tarefa.
  Nenhum vai na definição da tarefa nem no repositório; do GitHub para o
  Pulumi, passam pela entrada padrão.
- **Ficou de fora, de propósito:** NAT, WAF e domínio próprio, por custo.
  Também alta disponibilidade (uma tarefa web): para uma demonstração que
  sobe e desce, não compensa dobrar o custo.

## Verificação sem nuvem

`infra/tests` roda os dois programas com os mocks do Pulumi. Nada vai para a
AWS, e os testes conferem o que seria criado:

- load balancer interno, em sub-rede privada, só para o CloudFront;
- nenhum segredo em texto na definição das tarefas;
- pagamentos sem o banco da loja;
- sem NAT gateway, workers em Spot, tudo em ARM;
- role de deploy só para a `main` deste repo, pelos ids imutáveis, e sem
  política ampla.

Roda na CI de todo PR (`cd infra && npm test`).

## Próximos passos

- Domínio próprio (uns US$ 10/ano): certificado ACM, TLS 1.2+ no CloudFront,
  HTTPS até o load balancer e um nome no lugar do `cloudfront.net`.
- Ambiente `aws` no GitHub com aprovação manual antes do deploy (a role
  passaria a aceitar só esse ambiente).
- Fotos do painel no S3 (hoje vão para o disco da tarefa).
- Com orçamento: tarefas em sub-rede privada + NAT, WAF no CloudFront e duas
  tarefas web em duas zonas.
