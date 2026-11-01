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
/** Só este repositório, só a `main`, assume a role de deploy. */
const repository = config.get("githubRepository") ?? "FlavioVic/dystopia";
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
        Condition: {
          StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
          StringLike: { "token.actions.githubusercontent.com:sub": `repo:${repository}:ref:refs/heads/main` },
        },
      },
    ],
  }),
});

// A conta é dedicada a este projeto: PowerUser (tudo menos IAM e conta) mais
// IAM só para as roles do próprio ambiente (prefixo dystopia-). Afinar para
// o mínimo de cada serviço fica como próximo passo (docs/AWS.md).
new aws.iam.RolePolicyAttachment("deploy-power-user", {
  role: deployRole.name,
  policyArn: "arn:aws:iam::aws:policy/PowerUserAccess",
});

const account = aws.getCallerIdentityOutput().accountId;
new aws.iam.RolePolicy("deploy-iam", {
  role: deployRole.id,
  policy: pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [
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
        Resource: pulumi.interpolate`arn:aws:iam::${account}:role/dystopia-*`,
      },
      {
        // ECS e o load balancer criam a própria role de serviço no primeiro uso.
        Sid: "RolesDeServico",
        Effect: "Allow",
        Action: "iam:CreateServiceLinkedRole",
        Resource: "*",
        Condition: {
          StringEquals: { "iam:AWSServiceName": ["ecs.amazonaws.com", "elasticloadbalancing.amazonaws.com"] },
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
