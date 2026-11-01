#!/usr/bin/env bash
# Roda uma tarefa avulsa do ECS (migração, seed) e espera ela terminar.
#
# Chamado pelo Pulumi (infra/app/index.ts, command.local.Command) ANTES de
# atualizar os serviços: se a tarefa sair com erro, este script sai com erro
# e o `pulumi up` para ali — código novo não sobe sem o schema dele.
#
#   run-task.sh <cluster> <task-definition-arn> <subnet,subnet> <security-group> <nome>
set -euo pipefail

cluster="$1"
task_definition="$2"
subnets="$3"
security_group="$4"
name="$5"

network="awsvpcConfiguration={subnets=[$subnets],securityGroups=[$security_group],assignPublicIp=ENABLED}"

task=$(aws ecs run-task \
  --cluster "$cluster" \
  --task-definition "$task_definition" \
  --launch-type FARGATE \
  --network-configuration "$network" \
  --started-by "pulumi-$name" \
  --query 'tasks[0].taskArn' \
  --output text)

if [ -z "$task" ] || [ "$task" = "None" ]; then
  echo "tarefa $name não foi criada (veja 'failures' em aws ecs run-task)" >&2
  exit 1
fi

echo "tarefa $name: $task"
# Espera até ~10 min (o waiter da AWS: 100 tentativas, 6 s entre elas).
aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$task"

read -r code reason < <(aws ecs describe-tasks \
  --cluster "$cluster" \
  --tasks "$task" \
  --query 'tasks[0].[containers[0].exitCode, stoppedReason]' \
  --output text)

echo "tarefa $name terminou: código $code ($reason)"
if [ "$code" != "0" ]; then
  echo "logs: CloudWatch, grupo /dystopia/aws, fluxo $name/..." >&2
  exit 1
fi
