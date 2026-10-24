-- Carrinho: uma linha por (carrinho, produto, variante), com variant_id NULL
-- contando como repetido (NULLS NOT DISTINCT). O índice antigo não pegava
-- NULL, e o "lê, decide, escreve" da action deixava dois cliques simultâneos
-- duplicarem a linha — então pode haver duplicata em produção. Antes da
-- restrição, junta as duplicatas na linha mais antiga (soma, teto de 10 —
-- o mesmo MAX_PER_ITEM do serviço) e apaga as outras.
WITH ranked AS (
	SELECT
		"id",
		first_value("id") OVER w AS "keep_id",
		LEAST(sum("quantity") OVER (PARTITION BY "cart_id", "product_id", "variant_id"), 10) AS "total",
		row_number() OVER w AS "rn"
	FROM "cart_items"
	WINDOW w AS (PARTITION BY "cart_id", "product_id", "variant_id" ORDER BY "created_at", "id")
),
merged AS (
	UPDATE "cart_items" ci SET "quantity" = r."total"
	FROM ranked r
	WHERE ci."id" = r."id" AND r."rn" = 1
	  AND EXISTS (SELECT 1 FROM ranked d WHERE d."keep_id" = r."id" AND d."rn" > 1)
)
DELETE FROM "cart_items" ci USING ranked r WHERE ci."id" = r."id" AND r."rn" > 1;--> statement-breakpoint
DROP INDEX "cart_items_cart_product_variant_unique_idx";--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_product_variant_unique" UNIQUE NULLS NOT DISTINCT("cart_id","product_id","variant_id");