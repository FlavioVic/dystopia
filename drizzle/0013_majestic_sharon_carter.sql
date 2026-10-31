CREATE TYPE "public"."order_event_type" AS ENUM('placed', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"type" "order_event_type" NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_events_order_id_idx" ON "order_events" USING btree ("order_id","occurred_at");--> statement-breakpoint
-- Pedidos que já existem ganham o histórico possível: "recebido" na criação e
-- o status atual na última atualização. O motivo do cancelamento vem do código
-- que a saga deixou em last_error ("payment_declined: ...").
INSERT INTO "order_events" ("order_id", "type", "data", "occurred_at")
SELECT "id", 'placed', '{}'::jsonb, "created_at" FROM "orders";--> statement-breakpoint
INSERT INTO "order_events" ("order_id", "type", "data", "occurred_at")
SELECT
	o."id",
	o."status"::text::"order_event_type",
	CASE
		WHEN o."status" = 'cancelled' AND s."last_error" IS NOT NULL
			THEN jsonb_build_object('reason', split_part(s."last_error", ':', 1))
		ELSE '{}'::jsonb
	END,
	o."updated_at"
FROM "orders" o
LEFT JOIN LATERAL (
	SELECT "last_error" FROM "sagas"
	WHERE "correlation_id" = o."order_number"
	ORDER BY "created_at" DESC
	LIMIT 1
) s ON true
WHERE o."status" <> 'pending';
