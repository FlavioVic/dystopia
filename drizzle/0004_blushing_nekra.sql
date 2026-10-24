CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "status" "notification_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "delivered_to" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
-- Notificações anteriores eram só uma linha no banco (entrega simulada): já
-- "enviadas". Sem isto viravam pendentes que nenhum job vai entregar.
UPDATE "notifications" SET "status" = 'sent', "provider" = 'simulado', "delivered_to" = "recipient", "sent_at" = "created_at";
