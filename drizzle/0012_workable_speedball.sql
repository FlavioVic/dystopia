ALTER TABLE "saga_steps" ADD COLUMN "deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "saga_steps" ADD COLUMN "status_checks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "saga_steps_deadline_idx" ON "saga_steps" USING btree ("deadline_at");