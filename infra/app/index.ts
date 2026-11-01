import * as path from "node:path";
import * as aws from "@pulumi/aws";
import * as command from "@pulumi/command";
import * as pulumi from "@pulumi/pulumi";

/**
 * Ambiente AWS do DYSTOPIA — o 2º ambiente (a produção é a Vercel). Sobe e
 * desce pelo GitHub Actions (.github/workflows/aws.yml); ver docs/AWS.md.
 *
 * Híbrido, por custo (nada pago fora dos créditos da conta): os três
 * processos do app rodam no ECS Fargate; banco no Neon (projeto PRÓPRIO, para
 * não dividir a cota de compute com a produção) e fila no CloudAMQP (prefixo
 * próprio de filas), que são de graça.
 *
 *   navegador → CloudFront (HTTPS) → load balancer → web (Fargate)
 *               (o load balancer só aceita conexão vinda do CloudFront)
 *   worker e payments (Fargate Spot) consomem a fila; os três falam com o
 *   Neon e o CloudAMQP pela internet (sem NAT: tarefa com IP público).
 */

const config = new pulumi.Config();
const region = aws.config.requireRegion();

// Imagens: o workflow constrói, manda para o ECR da base e passa a tag.
const webImage = config.require("webImage");
const workerImage = config.require("workerImage");
// Segredos que vêm de fora (secrets do GitHub, ver docs/AWS.md).
const neonOwnerUrl = config.requireSecret("neonOwnerUrl");
const rabbitmqUrl = config.requireSecret("rabbitmqUrl");
const stripePublishableKey = config.get("stripePublishableKey");
const stripeSecretKey = config.getSecret("stripeSecretKey");
/** Popular o banco (apaga e recria os dados): só no primeiro "subir". */
const seed = config.getBoolean("seed") ?? false;

// Segredos gerados pela base: sobrevivem ao "derrubar", como o banco.
const base = new pulumi.StackReference(
  config.get("bootstrapStack") ?? `${pulumi.getOrganization()}/dystopia-bootstrap/${pulumi.getStack()}`,
);
const appDbPassword = base.requireOutput("appDbPassword") as pulumi.Output<string>;
const mfaEncryptionKey = base.requireOutput("mfaEncryptionKey") as pulumi.Output<string>;
const seedAdminPassword = base.requireOutput("seedAdminPassword") as pulumi.Output<string>;

// ---------------------------------------------------------------- bancos

/** Mesmo servidor, outro banco: pagamentos mora no mesmo projeto Neon. */
function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** Mesmo banco, outro usuário: o app conecta como `dystopia_app` (só DML). */
function asApp(url: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = "dystopia_app";
  parsed.password = password;
  return parsed.toString();
}

const ownerPaymentsUrl = neonOwnerUrl.apply((url) => withDatabase(url, "dystopia_payments"));
const appStoreUrl = pulumi.all([neonOwnerUrl, appDbPassword]).apply(([url, password]) => asApp(url, password));
const appPaymentsUrl = pulumi.all([ownerPaymentsUrl, appDbPassword]).apply(([url, password]) => asApp(url, password));

// ---------------------------------------------------------------- rede

// Só sub-redes públicas e nenhum NAT gateway (cobra por hora): as tarefas
// ganham IP público para sair para Neon, CloudAMQP, Stripe e ECR, e a
// entrada é fechada pelos security groups.
const vpc = new aws.ec2.Vpc("vpc", {
  cidrBlock: "10.20.0.0/16",
  enableDnsHostnames: true,
  enableDnsSupport: true,
  tags: { Name: "dystopia-aws" },
});
const internet = new aws.ec2.InternetGateway("internet", { vpcId: vpc.id });
const publicRoutes = new aws.ec2.RouteTable("public", {
  vpcId: vpc.id,
  routes: [{ cidrBlock: "0.0.0.0/0", gatewayId: internet.id }],
});

// O load balancer exige duas zonas.
const zones = aws.getAvailabilityZonesOutput({ state: "available" }).names;
const subnets = [0, 1].map(
  (index) =>
    new aws.ec2.Subnet(`public-${index}`, {
      vpcId: vpc.id,
      cidrBlock: `10.20.${index}.0/24`,
      availabilityZone: zones[index],
      tags: { Name: `dystopia-aws-public-${index}` },
    }),
);
const routeAssociations = subnets.map(
  (subnet, index) => new aws.ec2.RouteTableAssociation(`public-${index}`, { subnetId: subnet.id, routeTableId: publicRoutes.id }),
);
const subnetIds = subnets.map((subnet) => subnet.id);

const anywhere = [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }];

// O load balancer só aceita o CloudFront (lista de IPs mantida pela AWS):
// ninguém chega direto nele com um CloudFront-Viewer-Address forjado.
const cloudfrontOrigins = aws.ec2.getManagedPrefixListOutput({ name: "com.amazonaws.global.cloudfront.origin-facing" });
const albSecurity = new aws.ec2.SecurityGroup("alb", {
  vpcId: vpc.id,
  description: "Load balancer: entrada so do CloudFront",
  ingress: [{ protocol: "tcp", fromPort: 80, toPort: 80, prefixListIds: [cloudfrontOrigins.id], description: "CloudFront" }],
  egress: anywhere,
});
const webSecurity = new aws.ec2.SecurityGroup("web", {
  vpcId: vpc.id,
  description: "App web: entrada so do load balancer",
  ingress: [{ protocol: "tcp", fromPort: 3000, toPort: 3000, securityGroups: [albSecurity.id], description: "load balancer" }],
  egress: anywhere,
});
const workerSecurity = new aws.ec2.SecurityGroup("worker", {
  vpcId: vpc.id,
  description: "Workers e tarefas avulsas: sem entrada",
  egress: anywhere,
});

// ---------------------------------------------------------------- segredos (SSM)

// Parameter Store (SecureString, camada padrão) e não Secrets Manager: o
// padrão é gratuito, o Secrets Manager cobra por segredo por mês. O ECS lê
// na hora de subir a tarefa; o valor não aparece na definição da tarefa.
function secretParameter(name: string, value: pulumi.Input<string>): aws.ssm.Parameter {
  return new aws.ssm.Parameter(name, { name: `/dystopia/aws/${name}`, type: "SecureString", tier: "Standard", value });
}

const secrets = {
  storeUrl: secretParameter("database-url", appStoreUrl),
  paymentsUrl: secretParameter("payments-database-url", appPaymentsUrl),
  ownerStoreUrl: secretParameter("owner-database-url", neonOwnerUrl),
  ownerPaymentsUrl: secretParameter("owner-payments-database-url", ownerPaymentsUrl),
  rabbitmqUrl: secretParameter("rabbitmq-url", rabbitmqUrl),
  mfaEncryptionKey: secretParameter("mfa-encryption-key", mfaEncryptionKey),
  appDbPassword: secretParameter("app-db-password", appDbPassword),
  seedAdminPassword: secretParameter("seed-admin-password", seedAdminPassword),
  stripeSecretKey: stripeSecretKey ? secretParameter("stripe-secret-key", stripeSecretKey) : undefined,
};

// ---------------------------------------------------------------- ECS: cluster, roles, logs

const logs = new aws.cloudwatch.LogGroup("logs", { name: "/dystopia/aws", retentionInDays: 7 });

const cluster = new aws.ecs.Cluster("cluster", {
  name: "dystopia",
  // Container Insights cobra à parte; os logs vão para o CloudWatch.
  settings: [{ name: "containerInsights", value: "disabled" }],
});
const capacity = new aws.ecs.ClusterCapacityProviders("capacity", {
  clusterName: cluster.name,
  capacityProviders: ["FARGATE", "FARGATE_SPOT"],
});

const ecsTasks = JSON.stringify({
  Version: "2012-10-17",
  Statement: [{ Effect: "Allow", Principal: { Service: "ecs-tasks.amazonaws.com" }, Action: "sts:AssumeRole" }],
});

// Quem SOBE a tarefa (puxa a imagem, lê os segredos, escreve o log)…
const executionRole = new aws.iam.Role("execution", { namePrefix: "dystopia-exec-", assumeRolePolicy: ecsTasks });
new aws.iam.RolePolicyAttachment("execution-ecs", {
  role: executionRole.name,
  policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
});
const executionSecrets = new aws.iam.RolePolicy("execution-secrets", {
  role: executionRole.id,
  policy: pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: "ssm:GetParameters",
        Resource: Object.values(secrets).flatMap((parameter) => (parameter ? [parameter.arn] : [])),
      },
    ],
  }),
});
// …e quem RODA dentro dela: o app não chama API da AWS, então nenhuma permissão.
const taskRole = new aws.iam.Role("task", { namePrefix: "dystopia-task-", assumeRolePolicy: ecsTasks });

type Container = {
  name: string;
  image: string;
  command?: string[];
  port?: number;
  environment: Record<string, string | undefined>;
  secrets: Record<string, aws.ssm.Parameter | undefined>;
};

/** Comum aos processos do app. */
const appEnvironment = {
  NODE_ENV: "production",
  LOG_FORMAT: "json",
  // Mesmo CloudAMQP da produção, outras filas: as duas nunca se misturam.
  RABBITMQ_PREFIX: "dystopia_aws",
  ALLOW_CHECKOUT_SIMULATION: "1",
  PG_POOL_MAX: "5",
};

function taskDefinition(container: Container, size: { cpu: number; memory: number }): aws.ecs.TaskDefinition {
  const definition = pulumi.jsonStringify([
    {
      name: container.name,
      image: container.image,
      essential: true,
      command: container.command,
      portMappings: container.port ? [{ containerPort: container.port, protocol: "tcp" }] : [],
      environment: Object.entries(container.environment)
        .filter((entry): entry is [string, string] => entry[1] !== undefined)
        .map(([name, value]) => ({ name, value })),
      secrets: Object.entries(container.secrets)
        .filter((entry): entry is [string, aws.ssm.Parameter] => entry[1] !== undefined)
        .map(([name, parameter]) => ({ name, valueFrom: parameter.arn })),
      logConfiguration: {
        logDriver: "awslogs",
        options: { "awslogs-group": logs.name, "awslogs-region": region, "awslogs-stream-prefix": container.name },
      },
      // SIGTERM (deploy, interrupção do Spot): o worker termina o que pegou.
      stopTimeout: 30,
    },
  ]);
  return new aws.ecs.TaskDefinition(
    container.name,
    {
      family: `dystopia-${container.name}`,
      cpu: String(size.cpu),
      memory: String(size.memory),
      networkMode: "awsvpc",
      requiresCompatibilities: ["FARGATE"],
      // Graviton (ARM): ~20% mais barato que x86 no Fargate.
      runtimePlatform: { operatingSystemFamily: "LINUX", cpuArchitecture: "ARM64" },
      executionRoleArn: executionRole.arn,
      taskRoleArn: taskRole.arn,
      containerDefinitions: definition,
    },
    { dependsOn: [executionSecrets] },
  );
}

const small = { cpu: 256, memory: 512 };

const web = taskDefinition(
  {
    name: "web",
    image: webImage,
    port: 3000,
    environment: {
      ...appEnvironment,
      // IP do cliente para o limite de tentativas: o que o CloudFront escreveu.
      TRUST_PROXY_HEADERS: "cloudfront",
      // Fotos enviadas pelo painel: disco da tarefa (some num novo deploy).
      UPLOADS_DIR: "/tmp/dystopia-uploads",
      STRIPE_PUBLISHABLE_KEY: stripePublishableKey,
    },
    secrets: {
      DATABASE_URL: secrets.storeUrl,
      PAYMENTS_DATABASE_URL: secrets.paymentsUrl,
      RABBITMQ_URL: secrets.rabbitmqUrl,
      MFA_ENCRYPTION_KEY: secrets.mfaEncryptionKey,
    },
  },
  { cpu: 512, memory: 1024 },
);

const worker = taskDefinition(
  {
    name: "worker",
    image: workerImage,
    // Pagamentos roda no serviço dele (abaixo), como no docker-compose.
    environment: { ...appEnvironment, WORKER_QUEUES: "saga,notifications" },
    secrets: {
      DATABASE_URL: secrets.storeUrl,
      PAYMENTS_DATABASE_URL: secrets.paymentsUrl,
      RABBITMQ_URL: secrets.rabbitmqUrl,
    },
  },
  small,
);

// Pagamentos não recebe a URL do banco da loja: a fronteira é de dados.
const payments = taskDefinition(
  {
    name: "payments",
    image: workerImage,
    command: ["node", "--import", "tsx", "src/scripts/payments-worker.ts"],
    environment: appEnvironment,
    secrets: {
      PAYMENTS_DATABASE_URL: secrets.paymentsUrl,
      RABBITMQ_URL: secrets.rabbitmqUrl,
      STRIPE_SECRET_KEY: secrets.stripeSecretKey,
    },
  },
  small,
);

// Tarefas avulsas: rodam como DONO do banco (migração e seed mexem em schema).
const migrate = taskDefinition(
  {
    name: "migrate",
    image: workerImage,
    command: ["sh", "-c", "npm run db:migrate && npm run db:app-role"],
    // Cria o banco de pagamentos no primeiro "subir".
    environment: { ...appEnvironment, PAYMENTS_DATABASE_CREATE: "1" },
    secrets: {
      DATABASE_URL: secrets.ownerStoreUrl,
      PAYMENTS_DATABASE_URL: secrets.ownerPaymentsUrl,
      APP_DB_PASSWORD: secrets.appDbPassword,
    },
  },
  small,
);

const seedTask = taskDefinition(
  {
    name: "seed",
    image: workerImage,
    command: ["npm", "run", "db:seed"],
    environment: { ...appEnvironment, SEED_ALLOW_REMOTE: "1" },
    secrets: {
      DATABASE_URL: secrets.ownerStoreUrl,
      PAYMENTS_DATABASE_URL: secrets.ownerPaymentsUrl,
      SEED_ADMIN_PASSWORD: secrets.seedAdminPassword,
    },
  },
  { cpu: 512, memory: 1024 },
);

// ---------------------------------------------------------------- migração antes dos serviços

// O Pulumi roda a migração (tarefa avulsa) e só então atualiza os serviços:
// código novo nunca sobe antes do schema dele. Roda de novo a cada imagem
// nova (a revisão da definição muda); falhou, o `pulumi up` para aqui.
const runTask = path.join(__dirname, "scripts", "run-task.sh");
const subnetList = pulumi.all(subnetIds).apply((ids) => ids.join(","));
function runOnce(name: string, definition: aws.ecs.TaskDefinition, dependsOn: pulumi.Resource[]): command.local.Command {
  return new command.local.Command(
    name,
    {
      create: pulumi.interpolate`bash ${runTask} ${cluster.name} ${definition.arn} ${subnetList} ${workerSecurity.id} ${name}`,
      triggers: [definition.arn],
      environment: { AWS_REGION: region },
      logging: "stdoutAndStderr",
    },
    { dependsOn },
  );
}

const migration = runOnce("migration", migrate, [capacity, internet, ...routeAssociations]);
const seeding = seed ? runOnce("seeding", seedTask, [migration]) : undefined;
const ready = seeding ? [migration, seeding] : [migration];

// ---------------------------------------------------------------- entrada: load balancer + CloudFront

const loadBalancer = new aws.lb.LoadBalancer(
  "web",
  {
    loadBalancerType: "application",
    internal: false,
    securityGroups: [albSecurity.id],
    subnets: subnetIds,
    idleTimeout: 65,
  },
  { dependsOn: [internet] },
);
const targets = new aws.lb.TargetGroup("web", {
  port: 3000,
  protocol: "HTTP",
  targetType: "ip",
  vpcId: vpc.id,
  deregistrationDelay: 30,
  // Pronto = responde uma página que consulta o banco (como no compose).
  healthCheck: { path: "/produtos", matcher: "200", interval: 30, timeout: 10, healthyThreshold: 2, unhealthyThreshold: 5 },
});
const listener = new aws.lb.Listener("http", {
  loadBalancerArn: loadBalancer.arn,
  port: 80,
  protocol: "HTTP",
  defaultActions: [{ type: "forward", targetGroupArn: targets.arn }],
});

// Políticas gerenciadas da AWS, achadas pelo nome (os ids não mudam, mas o
// nome se lê).
const noCache = aws.cloudfront.getCachePolicyOutput({ name: "Managed-CachingDisabled" });
const staticCache = aws.cloudfront.getCachePolicyOutput({ name: "Managed-CachingOptimized" });
// Repassa tudo do navegador (cookies, Host — a Server Action confere Origin x
// Host) e os headers do CloudFront, entre eles o CloudFront-Viewer-Address.
const forwardAll = aws.cloudfront.getOriginRequestPolicyOutput({ name: "Managed-AllViewerAndCloudFrontHeaders-2022-06" });
const required = (id: string | undefined) => {
  if (!id) throw new Error("política gerenciada do CloudFront não encontrada");
  return id;
};

const cdn = new aws.cloudfront.Distribution("web", {
  enabled: true,
  isIpv6Enabled: true,
  comment: "dystopia-aws",
  // Só América do Norte e Europa: a faixa mais barata.
  priceClass: "PriceClass_100",
  origins: [
    {
      originId: "load-balancer",
      domainName: loadBalancer.dnsName,
      // HTTP até o load balancer: HTTPS na origem exigiria um domínio próprio
      // com certificado (docs/AWS.md › limites).
      customOriginConfig: {
        httpPort: 80,
        httpsPort: 443,
        originProtocolPolicy: "http-only",
        originSslProtocols: ["TLSv1.2"],
        originReadTimeout: 60,
      },
    },
  ],
  defaultCacheBehavior: {
    targetOriginId: "load-balancer",
    viewerProtocolPolicy: "redirect-to-https",
    allowedMethods: ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
    cachedMethods: ["GET", "HEAD"],
    cachePolicyId: noCache.apply((policy) => required(policy.id)),
    originRequestPolicyId: forwardAll.apply((policy) => required(policy.id)),
    compress: true,
  },
  // JS e CSS do Next têm hash no nome: podem ficar no cache da borda.
  orderedCacheBehaviors: [
    {
      pathPattern: "/_next/static/*",
      targetOriginId: "load-balancer",
      viewerProtocolPolicy: "redirect-to-https",
      allowedMethods: ["GET", "HEAD"],
      cachedMethods: ["GET", "HEAD"],
      cachePolicyId: staticCache.apply((policy) => required(policy.id)),
      compress: true,
    },
  ],
  restrictions: { geoRestriction: { restrictionType: "none" } },
  viewerCertificate: { cloudfrontDefaultCertificate: true },
});

// ---------------------------------------------------------------- serviços

const network = (security: aws.ec2.SecurityGroup) => ({
  subnets: subnetIds,
  securityGroups: [security.id],
  assignPublicIp: true,
});
const rollback = { enable: true, rollback: true };

new aws.ecs.Service(
  "web",
  {
    name: "web",
    cluster: cluster.arn,
    taskDefinition: web.arn,
    desiredCount: 1,
    // O site fica em Fargate normal: o Spot pode ser interrompido.
    launchType: "FARGATE",
    networkConfiguration: network(webSecurity),
    loadBalancers: [{ targetGroupArn: targets.arn, containerName: "web", containerPort: 3000 }],
    healthCheckGracePeriodSeconds: 120,
    deploymentCircuitBreaker: rollback,
    waitForSteadyState: true,
  },
  { dependsOn: [listener, ...ready] },
);

// Workers em Fargate Spot (~70% mais barato): se a AWS interromper, o broker
// reentrega o que não teve ack e o ECS sobe outra tarefa.
const spot = [{ capacityProvider: "FARGATE_SPOT", weight: 1 }];
for (const [name, definition] of [
  ["worker", worker],
  ["payments", payments],
] as const) {
  new aws.ecs.Service(
    name,
    {
      name,
      cluster: cluster.arn,
      taskDefinition: definition.arn,
      desiredCount: 1,
      capacityProviderStrategies: spot,
      networkConfiguration: network(workerSecurity),
      deploymentCircuitBreaker: rollback,
      waitForSteadyState: true,
    },
    { dependsOn: [capacity, ...ready] },
  );
}

export const url = pulumi.interpolate`https://${cdn.domainName}`;
export const loadBalancerDns = loadBalancer.dnsName;
export const clusterName = cluster.name;
export const logGroup = logs.name;
