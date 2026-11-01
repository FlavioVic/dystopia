/**
 * A base (infra/bootstrap) com mocks do Pulumi: quem pode assumir a role de
 * deploy e o que ela pode fazer. É a porta de entrada da conta — errar aqui
 * é dar a conta para outro repositório, ou poder demais para o GitHub.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import * as pulumi from "@pulumi/pulumi";

type Registered = { type: string; name: string; inputs: Record<string, any> };
const resources: Registered[] = [];

pulumi.runtime.setAllConfig({ "aws:region": "us-east-1", "dystopia-bootstrap:budgetEmail": "alerta@exemplo.dev" });
pulumi.runtime.setMocks(
  {
    newResource(args) {
      resources.push({ type: args.type, name: args.name, inputs: args.inputs });
      return {
        id: `${args.name}-id`,
        state: {
          ...args.inputs,
          arn: `arn:aws:mock:${args.type}:${args.name}`,
          repositoryUrl: `123.dkr.ecr.us-east-1.amazonaws.com/${args.inputs.name}`,
          result: "gerado",
          base64: "Z2VyYWRv",
        },
      };
    },
    call(args) {
      if (args.token === "aws:index/getCallerIdentity:getCallerIdentity") return { accountId: "123456789012" };
      return args.inputs;
    },
  },
  "dystopia-bootstrap",
  "aws",
  false,
  "organizacao-de-teste",
);

const named = (type: string, name: string) => {
  const found = resources.find((resource) => resource.type === type && resource.name === name);
  assert.ok(found, `${type} ${name} não foi criado`);
  return found;
};

before(async () => {
  const program = await import("../bootstrap/index");
  await new Promise<void>((resolve) => pulumi.all([program.deployRoleArn, program.webRepositoryUrl]).apply(() => resolve()));
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
});

describe("base da conta: quem entra", () => {
  it("só a main deste repositório (pelos ids imutáveis), com igualdade exata", () => {
    const trust = JSON.parse(named("aws:iam/role:Role", "deploy").inputs.assumeRolePolicy);
    const condition = trust.Statement[0].Condition;
    assert.deepEqual(Object.keys(condition), ["StringEquals"], "sem StringLike: curinga entregaria a role a outros");
    assert.equal(condition.StringEquals["token.actions.githubusercontent.com:aud"], "sts.amazonaws.com");
    assert.equal(
      condition.StringEquals["token.actions.githubusercontent.com:sub"],
      "repo:FlavioVic@179766320/dystopia@1428894143:ref:refs/heads/main",
    );
  });
});

describe("base da conta: o que o deploy pode", () => {
  it("nenhuma política ampla da AWS (PowerUser, Administrator)", () => {
    const attached = resources.filter((resource) => resource.type === "aws:iam/rolePolicyAttachment:RolePolicyAttachment");
    assert.deepEqual(attached, []);
  });

  it("IAM só nas roles do ambiente; ECR e Parameter Store só nos recursos do projeto", () => {
    const statements = JSON.parse(named("aws:iam/rolePolicy:RolePolicy", "deploy").inputs.policy).Statement;
    const bySid = (sid: string) => statements.find((statement: any) => statement.Sid === sid);
    assert.equal(bySid("RolesDoAmbiente").Resource, "arn:aws:iam::123456789012:role/dystopia-*");
    assert.equal(bySid("Imagens").Resource, "arn:aws:ecr:us-east-1:123456789012:repository/dystopia-*");
    assert.equal(bySid("Segredos").Resource, "arn:aws:ssm:us-east-1:123456789012:parameter/dystopia/*");
    for (const statement of statements) {
      const actions = [statement.Action].flat();
      assert.ok(!actions.includes("*") && !actions.some((action: string) => action.startsWith("iam:*")), statement.Sid);
      assert.ok(!actions.some((action: string) => /^(ec2:RunInstances|rds:|iam:CreateUser|iam:CreateAccessKey)/.test(action)), statement.Sid);
    }
  });

  it("alerta de gasto sobre o custo bruto (no plano Free o líquido é sempre zero)", () => {
    const budget = named("aws:budgets/budget:Budget", "monthly").inputs;
    assert.equal(budget.costTypes.includeCredit, false);
    assert.deepEqual(budget.notifications.map((n: any) => n.subscriberEmailAddresses), [["alerta@exemplo.dev"], ["alerta@exemplo.dev"]]);
  });
});
