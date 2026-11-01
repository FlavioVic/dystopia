import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";

/**
 * Base de vida longa do ambiente AWS — roda UMA vez, da máquina do dono, com
 * credencial de administrador (docs/AWS.md). Fica de pé quando o ambiente é
 * derrubado: nada aqui cobra por hora.
 *
 * - acesso do GitHub Actions por OIDC: o workflow assume uma role com um
 *   token de curta duração; nenhuma chave da AWS fica guardada no GitHub;
 * - registros de imagem (ECR) — as imagens sobrevivem ao "derrubar";
 * - segredos gerados (senha do papel do app no banco, chave do MFA, senha do
 *   admin do seed): se morassem no ambiente, cada "subir" geraria outros e o
 *   banco (que fica) deixaria de abrir;
 * - alerta de gasto por e-mail.
 */

const config = new pulumi.Config();
/**
 * Quem pode assumir a role de deploy: só a `main` DESTE repositório. O
 * GitHub identifica o repositório pelos ids imutáveis do dono e do repo
 * (formato padrão para repositórios criados depois de 15/07/2026):
 * renomear ou recriar um repo com o mesmo nome não herda o acesso.
 * Os ids são públicos (`gh api repos/FlavioVic/dystopia`).
 */
const githubSubject =
  config.get("githubSubject") ?? "repo:FlavioVic@179766320/dystopia@1428894143:ref:refs/heads/main";
const budgetEmail = config.get("budgetEmail");
const monthlyBudgetUsd = config.getNumber("monthlyBudgetUsd") ?? 20;

// ---------------------------------------------------------------- GitHub → AWS (OIDC)

const github = new aws.iam.OpenIdConnectProvider("github", {
  url: "https://token.actions.githubusercontent.com",
  clientIdLists: ["sts.amazonaws.com"],
});

const deployRole = new aws.iam.Role("deploy", {
  name: "dystopia-github-deploy",
  description: "Deploy do ambiente AWS pelo GitHub Actions (so a main do repositorio)",
  maxSessionDuration: 3600,
  assumeRolePolicy: pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Federated: github.arn },
        Action: "sts:AssumeRoleWithWebIdentity",
        // Igualdade exata nos dois: sem curinga, nenhum outro repo, branch ou fork.
        Condition: {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": githubSubject,
          },
        },
      },
    ],
  }),
});

// Permissões: só os serviços que o ambiente usa, e presas aos recursos
// dystopia-* onde a AWS deixa (ECR, Parameter Store, IAM). Nada de
// PowerUser: o deploy não consegue, por exemplo, subir uma EC2, criar um
// banco ou mexer em usuários.
const account = aws.getCallerIdentityOutput().accountId;
const region = aws.config.requireRegion();
const arn = (service: string, resource: pulumi.Input<string>, scope: string = region) =>
  pulumi.interpolate`arn:aws:${service}:${scope}:${account}:${resource}`;

new aws.iam.RolePolicy("deploy", {
  role: deployRole.id,
  policy: pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "Rede",
        Effect: "Allow",
        Action: [
          "ec2:Describe*",
          "ec2:Get*",
          "ec2:CreateTags",
          "ec2:DeleteTags",
          "ec2:CreateVpc",
          "ec2:DeleteVpc",
          "ec2:ModifyVpcAttribute",
          "ec2:CreateSubnet",
          "ec2:DeleteSubnet",
          "ec2:ModifySubnetAttribute",
          "ec2:CreateInternetGateway",
          "ec2:DeleteInternetGateway",
          "ec2:AttachInternetGateway",
          "ec2:DetachInternetGateway",
          "ec2:CreateRouteTable",
          "ec2:DeleteRouteTable",
          "ec2:CreateRoute",
          "ec2:DeleteRoute",
          "ec2:ReplaceRoute",
          "ec2:AssociateRouteTable",
          "ec2:DisassociateRouteTable",
          "ec2:CreateSecurityGroup",
          "ec2:DeleteSecurityGroup",
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:AuthorizeSecurityGroupEgress",
          "ec2:RevokeSecurityGroupIngress",
          "ec2:RevokeSecurityGroupEgress",
          "ec2:ModifySecurityGroupRules",
          "ec2:UpdateSecurityGroupRuleDescriptionsIngress",
          "ec2:UpdateSecurityGroupRuleDescriptionsEgress",
        ],
        Resource: "*",
      },
      {
        Sid: "ContainersBalanceadorCdnLogs",
        Effect: "Allow",
        Action: ["ecs:*", "elasticloadbalancing:*", "cloudfront:*", "logs:*"],
        Resource: "*",
      },
      {
        // Montar e enviar as imagens: só para os repositórios do projeto.
        Sid: "Imagens",
        Effect: "Allow",
        Action: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:CompleteLayerUpload",
          "ecr:DescribeImages",
          "ecr:DescribeRepositories",
          "ecr:GetDownloadUrlForLayer",
          "ecr:InitiateLayerUpload",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
        ],
        Resource: arn("ecr", "repository/dystopia-*"),
      },
      { Sid: "LoginNoEcr", Effect: "Allow", Action: "ecr:GetAuthorizationToken", Resource: "*" },
      {
        // Segredos do ambiente (SecureString com a chave gerenciada aws/ssm).
        Sid: "Segredos",
        Effect: "Allow",
        Action: "ssm:*",
        Resource: arn("ssm", "parameter/dystopia/*"),
      },
      { Sid: "ListarSegredos", Effect: "Allow", Action: "ssm:DescribeParameters", Resource: "*" },
      {
        Sid: "RolesDoAmbiente",
        Effect: "Allow",
        Action: [
          "iam:CreateRole",
          "iam:DeleteRole",
          "iam:GetRole",
          "iam:TagRole",
          "iam:UntagRole",
          "iam:UpdateRole",
          "iam:UpdateAssumeRolePolicy",
          "iam:PassRole",
          "iam:PutRolePolicy",
          "iam:GetRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:AttachRolePolicy",
          "iam:DetachRolePolicy",
          "iam:ListRolePolicies",
          "iam:ListAttachedRolePolicies",
          "iam:ListInstanceProfilesForRole",
        ],
        Resource: arn("iam", "role/dystopia-*", ""),
      },
      {
        // ECS, load balancer e a VPC origin do CloudFront criam a própria
        // role de serviço no primeiro uso.
        Sid: "RolesDeServico",
        Effect: "Allow",
        Action: "iam:CreateServiceLinkedRole",
        Resource: "*",
        Condition: {
          StringEquals: {
            "iam:AWSServiceName": [
              "ecs.amazonaws.com",
              "elasticloadbalancing.amazonaws.com",
              "vpcorigin.cloudfront.amazonaws.com",
            ],
          },
        },
      },
    ],
  }),
});

// ---------------------------------------------------------------- imagens

function repositoryFor(name: string): aws.ecr.Repository {
  const repo = new aws.ecr.Repository(name, {
    name: `dystopia-${name}`,
    imageTagMutability: "MUTABLE",
    imageScanningConfiguration: { scanOnPush: true },
    forceDelete: true,
  });
  // Cobra por GB guardado: ficam só as 3 últimas.
  new aws.ecr.LifecyclePolicy(name, {
    repository: repo.name,
    policy: JSON.stringify({
      rules: [
        {
          rulePriority: 1,
          description: "so as 3 imagens mais recentes",
          selection: { tagStatus: "any", countType: "imageCountMoreThan", countNumber: 3 },
          action: { type: "expire" },
        },
      ],
    }),
  });
  return repo;
}

const webRepository = repositoryFor("web");
const workerRepository = repositoryFor("worker");

// ---------------------------------------------------------------- segredos gerados

/** Senha do papel `dystopia_app` no banco (o app só lê e grava linha). */
const appPassword = new random.RandomPassword("app-db-password", { length: 32, special: false });
/** Chave do segredo do autenticador do admin (32 bytes em base64, como `openssl rand -base64 32`). */
const mfaKey = new random.RandomBytes("mfa-encryption-key", { length: 32 });
/** Senha do admin criado pelo seed do ambiente AWS (veja com `pulumi stack output --show-secrets`). */
const adminPassword = new random.RandomPassword("seed-admin-password", { length: 24, special: false });

// ---------------------------------------------------------------- alerta de gasto

// Custo BRUTO, antes dos créditos: no plano Free a conta não cobra, então o
// custo líquido fica em zero e um alerta sobre ele nunca dispararia. Este
// avisa quanto dos créditos está indo embora.
if (budgetEmail) {
  new aws.budgets.Budget("monthly", {
    name: "dystopia-mensal",
    budgetType: "COST",
    limitAmount: String(monthlyBudgetUsd),
    limitUnit: "USD",
    timeUnit: "MONTHLY",
    costTypes: { includeCredit: false, includeRefund: false },
    notifications: [50, 100].map((threshold) => ({
      comparisonOperator: "GREATER_THAN",
      threshold,
      thresholdType: "PERCENTAGE",
      notificationType: "ACTUAL",
      subscriberEmailAddresses: [budgetEmail],
    })),
  });
}

export const deployRoleArn = deployRole.arn;
export const webRepositoryUrl = webRepository.repositoryUrl;
export const workerRepositoryUrl = workerRepository.repositoryUrl;
export const appDbPassword = pulumi.secret(appPassword.result);
export const mfaEncryptionKey = pulumi.secret(mfaKey.base64);
export const seedAdminPassword = pulumi.secret(adminPassword.result);
