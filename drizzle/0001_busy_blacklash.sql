CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'done', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."saga_status" AS ENUM('running', 'completed', 'compensating', 'compensated', 'failed');--> statement-breakpoint
CREATE TYPE "public"."saga_step_status" AS ENUM('pending', 'completed', 'compensated', 'failed');--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue" text DEFAULT 'default' NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"correlation_id" text,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saga_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"saga_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"status" "saga_step_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"output" jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sagas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"correlation_id" text NOT NULL,
	"status" "saga_status" DEFAULT 'running' NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text,
	"locked_by" text,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "saga_steps" ADD CONSTRAINT "saga_steps_saga_id_sagas_id_fk" FOREIGN KEY ("saga_id") REFERENCES "public"."sagas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_poll_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "jobs_queue_idx" ON "jobs" USING btree ("queue");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_key_active_unique_idx" ON "jobs" USING btree ("dedupe_key") WHERE status in ('queued', 'running', 'failed');--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_key_unique_idx" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_correlation_id_idx" ON "notifications" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saga_steps_saga_name_unique_idx" ON "saga_steps" USING btree ("saga_id","name");--> statement-breakpoint
CREATE INDEX "sagas_status_idx" ON "sagas" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sagas_correlation_id_idx" ON "sagas" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "sagas_lease_until_idx" ON "sagas" USING btree ("lease_until");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_key_unique_idx" ON "payments" USING btree ("idempotency_key");