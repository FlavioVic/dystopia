ALTER TYPE "public"."saga_status" ADD VALUE 'halted';--> statement-breakpoint
ALTER TABLE "sagas" ADD COLUMN "definition_version" integer DEFAULT 1 NOT NULL;