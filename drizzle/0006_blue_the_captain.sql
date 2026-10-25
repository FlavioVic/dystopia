CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"delay_ms" integer DEFAULT 0 NOT NULL,
	"publish_attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- A fila sai do Postgres pro RabbitMQ. O que estava EM VOO na tabela antiga
-- (pedido esperando o pagamento, retry agendado, e-mail por entregar) vira
-- mensagem na outbox — senão a saga ficaria esperando pra sempre uma resposta
-- cujo comando foi apagado. Nomes de fila mudam: `default` vira `saga` (ou
-- `notifications`, pra entrega de e-mail), e o endereço de resposta dentro dos
-- comandos de pagamento passa a apontar pra `saga` (sem a dedupe key antiga).
-- Retry agendado pro futuro mantém o atraso. Job concluído ou morto não entra.
INSERT INTO "outbox" ("queue", "type", "payload", "max_attempts", "delay_ms", "created_at")
SELECT
	CASE
		WHEN "queue" = 'payments' THEN 'payments'
		WHEN "type" = 'notifications.deliver' THEN 'notifications'
		ELSE 'saga'
	END,
	"type",
	CASE
		WHEN ("payload" -> 'replyTo') IS NOT NULL
			THEN jsonb_set("payload" #- '{replyTo,dedupeKey}', '{replyTo,queue}', '"saga"')
		ELSE "payload"
	END,
	"max_attempts",
	GREATEST(0, EXTRACT(EPOCH FROM ("run_at" - now())) * 1000)::integer,
	"created_at"
FROM "jobs"
WHERE "status" IN ('queued', 'running', 'failed')
	AND "type" <> 'saga.reconcile';--> statement-breakpoint
DROP TABLE "jobs" CASCADE;--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox" USING btree ("next_attempt_at") WHERE published_at is null;--> statement-breakpoint
DROP TYPE "public"."job_status";