/**
 * O programa do ambiente AWS rodando com mocks do Pulumi: nada vai para a
 * nuvem, mas o código roda inteiro e dá para conferir o que ele CRIARIA. Os
 * testes cobram as garantias de segurança e de custo que o desenho promete
 * (docs/AWS.md) — mudar uma delas sem querer quebra aqui, não na conta.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import * as pulumi from "@pulumi/pulumi";

type Registered = { type: string; name: string; inputs: Record<string, any> };
const resources: Registered[] = [];
const calls: { token: string; inputs: Record<string, any> }[] = [];

pulumi.runtime.setAllConfig(
  {
    "aws:region": "us-east-1",
    "dystopia-aws:webImage": "123.dkr.ecr.us-east-1.amazonaws.com/dystopia-web:abc",
    "dystopia-aws:workerImage": "123.dkr.ecr.us-east-1.amazonaws.com/dystopia-worker:abc",
    "dystopia-aws:neonOwnerUrl": "postgresql://neondb_owner:senha-do-dono@ep-teste.us-east-1.aws.neon.tech/neondb?sslmode=require",
    "dystopia-aws:rabbitmqUrl": "amqps://usuario:senha@cloudamqp.example/vhost",
    "dystopia-aws:stripePublishableKey": "pk_test_123",
    "dystopia-aws:stripeSecretKey": "sk_test_456",
  },
  ["dystopia-aws:neonOwnerUrl", "dystopia-aws:rabbitmqUrl", "dystopia-aws:stripeSecretKey"],
);

pulumi.runtime.setMocks(
  {
    newResource(args) {
      resources.push({ type: args.type, name: args.name, inputs: args.inputs });
      if (args.type === "pulumi:pulumi:StackReference") {
        return {
          id: args.name,
          state: {
            outputs: { appDbPassword: "senha-do-app", mfaEncryptionKey: "chave-mfa", seedAdminPassword: "senha-admin" },
          },
        };
      }
      return {
        id: `${args.name}-id`,
        state: {
          ...args.inputs,
          arn: `arn:aws:mock:${args.type}:${args.name}`,
          name: args.inputs.name ?? args.name,
          dnsName: `${args.name}.elb.amazonaws.com`,
          domainName: `${args.name}.cloudfront.net`,
        },
      };
    },
    call(args) {
      calls.push({ token: args.token, inputs: args.inputs });
      switch (args.token) {
        case "aws:index/getAvailabilityZones:getAvailabilityZones":
          return { names: ["us-east-1a", "us-east-1b", "us-east-1c"] };
        case "aws:ec2/getSecurityGroup:getSecurityGroup":
          return { id: "sg-cloudfront-vpc-origins" };
        case "aws:cloudfront/getCachePolicy:getCachePolicy":
        case "aws:cloudfront/getOriginRequestPolicy:getOriginRequestPolicy":
          return { id: `policy-${args.inputs.name}` };
        default:
          return args.inputs;
      }
    },
  },
  "dystopia-aws",
  "aws",
  false,
  "organizacao-de-teste",
);

const ofType = (type: string) => resources.filter((resource) => resource.type === type);
const named = (type: string, name: string) => {
  const found = resources.find((resource) => resource.type === type && resource.name === name);
  assert.ok(found, `${type} ${name} não foi criado`);
  return found;
};
const container = (name: string) => JSON.parse(named("aws:ecs/taskDefinition:TaskDefinition", name).inputs.containerDefinitions)[0];
const envOf = (name: string) => Object.fromEntries(container(name).environment.map((e: any) => [e.name, e.value]));
const secretNames = (name: string) => container(name).secrets.map((s: any) => s.name).sort();

before(async () => {
  const program = await import("../app/index");
  // Espera as saídas (dependem de quase tudo) e mais algumas voltas do loop,
  // para os mocks registrarem os recursos que ainda estavam a caminho.
  await new Promise<void>((resolve) => pulumi.all([program.url, program.clusterName]).apply(() => resolve()));
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
});

describe("ambiente AWS: segurança", () => {
  it("o load balancer é interno, em sub-rede privada (sem rota para a internet)", () => {
    const alb = named("aws:lb/loadBalancer:LoadBalancer", "web").inputs;
    assert.equal(alb.internal, true);
    assert.deepEqual(alb.subnets, ["private-0-id", "private-1-id"]);
    assert.equal(alb.dropInvalidHeaderFields, true);
    assert.equal(named("aws:ec2/routeTable:RouteTable", "private").inputs.routes ?? undefined, undefined);
    const associations = ofType("aws:ec2/routeTableAssociation:RouteTableAssociation");
    for (const index of [0, 1]) {
      assert.equal(associations.find((a) => a.inputs.subnetId === `private-${index}-id`)?.inputs.routeTableId, "private-id");
    }
  });

  it("o CloudFront chega no load balancer pela VPC origin, e só o security group dele entra", () => {
    const origin = named("aws:cloudfront/vpcOrigin:VpcOrigin", "web").inputs.vpcOriginEndpointConfig;
    assert.match(origin.arn, /loadBalancer.*web/);
    const cdnOrigin = named("aws:cloudfront/distribution:Distribution", "web").inputs.origins[0];
    assert.equal(cdnOrigin.vpcOriginConfig.vpcOriginId, "web-id");
    assert.equal(cdnOrigin.customOriginConfig, undefined, "nada de origem pública");

    const alb = named("aws:ec2/securityGroup:SecurityGroup", "alb").inputs;
    assert.equal(alb.ingress ?? undefined, undefined, "sem regra inline aberta");
    const rules = ofType("aws:vpc/securityGroupIngressRule:SecurityGroupIngressRule");
    assert.deepEqual(
      rules.map((rule) => [rule.inputs.securityGroupId, rule.inputs.referencedSecurityGroupId, rule.inputs.fromPort, rule.inputs.cidrIpv4]),
      [["alb-id", "sg-cloudfront-vpc-origins", 80, undefined]],
    );
    assert.deepEqual(alb.egress.map((rule: any) => [rule.fromPort, rule.cidrBlocks]), [[3000, ["10.20.0.0/16"]]]);
  });

  it("zonas sem suporte à VPC origin ficam de fora", () => {
    const zones = calls.find((call) => call.token === "aws:index/getAvailabilityZones:getAvailabilityZones");
    assert.ok(zones?.inputs.excludeZoneIds.includes("use1-az3"));
  });

  it("o app web só aceita o load balancer, e workers não aceitam nada", () => {
    const web = named("aws:ec2/securityGroup:SecurityGroup", "web");
    assert.equal(web.inputs.ingress.length, 1);
    assert.equal(web.inputs.ingress[0].fromPort, 3000);
    assert.deepEqual(web.inputs.ingress[0].cidrBlocks ?? [], []);
    assert.equal(named("aws:ec2/securityGroup:SecurityGroup", "worker").inputs.ingress ?? undefined, undefined);
  });

  it("segredo nenhum vai em texto na definição da tarefa: tudo vem do Parameter Store", () => {
    for (const task of ["web", "worker", "payments", "migrate", "seed"]) {
      const env = JSON.stringify(container(task).environment);
      for (const leaked of ["senha", "postgresql://", "amqps://", "sk_test_", "chave-mfa"]) {
        assert.ok(!env.includes(leaked), `${task}: "${leaked}" no environment`);
      }
    }
    for (const parameter of ofType("aws:ssm/parameter:Parameter")) {
      assert.equal(parameter.inputs.type, "SecureString", parameter.name);
      assert.equal(parameter.inputs.tier, "Standard", `${parameter.name}: a camada padrão é a gratuita`);
    }
  });

  it("o app conecta como dystopia_app; só migração e seed usam o dono do banco", () => {
    // Valor secreto chega ao mock embrulhado ({ value }): o Pulumi marca o segredo.
    const value = (name: string) => {
      const raw = named("aws:ssm/parameter:Parameter", name).inputs.value;
      return typeof raw === "string" ? raw : raw.value;
    };
    assert.match(value("database-url"), /^postgresql:\/\/dystopia_app:senha-do-app@ep-teste/);
    assert.match(value("payments-database-url"), /^postgresql:\/\/dystopia_app:senha-do-app@.*\/dystopia_payments\?/);
    const ownerOnly = (task: string) => container(task).secrets.find((s: any) => s.name === "DATABASE_URL")?.valueFrom;
    assert.match(ownerOnly("migrate"), /owner-database-url/);
    assert.match(ownerOnly("web"), /:database-url$/);
  });

  it("pagamentos não recebe o banco da loja (fronteira de dados), e só ele recebe a chave secreta do Stripe", () => {
    assert.deepEqual(secretNames("payments"), ["PAYMENTS_DATABASE_URL", "RABBITMQ_URL", "STRIPE_SECRET_KEY"]);
    for (const task of ["web", "worker"]) assert.ok(!secretNames(task).includes("STRIPE_SECRET_KEY"), task);
  });

  it("o web lê o IP do cliente do CloudFront e usa filas próprias no CloudAMQP compartilhado", () => {
    assert.equal(envOf("web").TRUST_PROXY_HEADERS, "cloudfront");
    for (const task of ["web", "worker", "payments"]) assert.equal(envOf(task).RABBITMQ_PREFIX, "dystopia_aws", task);
  });

  it("o CloudFront força HTTPS para quem acessa", () => {
    const cdn = named("aws:cloudfront/distribution:Distribution", "web");
    assert.equal(cdn.inputs.defaultCacheBehavior.viewerProtocolPolicy, "redirect-to-https");
    assert.equal(cdn.inputs.viewerCertificate.cloudfrontDefaultCertificate, true);
  });
});

describe("ambiente AWS: custo", () => {
  it("sem NAT gateway, sem Secrets Manager, sem Container Insights", () => {
    assert.equal(ofType("aws:ec2/eip:Eip").length, 0, "sem IP elástico");
    assert.equal(ofType("aws:ec2/natGateway:NatGateway").length, 0);
    assert.equal(ofType("aws:secretsmanager/secret:Secret").length, 0);
    assert.deepEqual(named("aws:ecs/cluster:Cluster", "cluster").inputs.settings, [{ name: "containerInsights", value: "disabled" }]);
  });

  it("workers em Fargate Spot; o site em Fargate normal (Spot pode ser interrompido)", () => {
    const service = (name: string) => named("aws:ecs/service:Service", name).inputs;
    assert.equal(service("web").launchType, "FARGATE");
    for (const worker of ["worker", "payments"]) {
      assert.deepEqual(service(worker).capacityProviderStrategies, [{ capacityProvider: "FARGATE_SPOT", weight: 1 }]);
    }
  });

  it("tudo em ARM (Graviton), logs guardados só 7 dias", () => {
    for (const task of ofType("aws:ecs/taskDefinition:TaskDefinition")) {
      assert.equal(task.inputs.runtimePlatform.cpuArchitecture, "ARM64", task.name);
    }
    assert.equal(named("aws:cloudwatch/logGroup:LogGroup", "logs").inputs.retentionInDays, 7);
  });

  it("seed só quando pedido: sem `seed`, a tarefa existe mas não roda", () => {
    assert.ok(named("aws:ecs/taskDefinition:TaskDefinition", "seed"));
    const commands = ofType("command:local:Command").map((resource) => resource.name);
    assert.deepEqual(commands, ["migration"]);
  });
});
