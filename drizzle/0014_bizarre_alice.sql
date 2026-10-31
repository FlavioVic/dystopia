ALTER TABLE "orders" ADD COLUMN "payment_method" "payment_method";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_status" "payment_status";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_provider" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_transaction_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
-- Pedidos que já existem ganham o resumo a partir da tabela antiga (ainda
-- neste banco): a cobrança mais recente de cada pedido.
UPDATE "orders" o SET
	"payment_method" = p."method",
	"payment_status" = p."status",
	"payment_provider" = p."provider",
	"payment_transaction_id" = p."transaction_id",
	"paid_at" = p."paid_at"
FROM (
	SELECT DISTINCT ON ("order_id") "order_id", "method", "status", "provider", "transaction_id", "paid_at"
	FROM "payments"
	ORDER BY "order_id", "created_at" DESC
) p
WHERE p."order_id" = o."id";
