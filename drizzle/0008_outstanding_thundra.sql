-- Busca full-text. `unaccent` (contrib, disponível no Neon e na imagem
-- oficial do Postgres) tira acento; o wrapper IMMUTABLE é o que deixa usá-la
-- num índice — a função original é STABLE por depender do dicionário.
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
	LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
	AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;--> statement-breakpoint
CREATE INDEX "products_search_idx" ON "products" USING gin ((setweight(to_tsvector('portuguese'::regconfig, f_unaccent(coalesce("name", '') || ' ' || coalesce("brand", '') || ' ' || coalesce("sku", ''))), 'A') || setweight(to_tsvector('portuguese'::regconfig, f_unaccent(coalesce("description", ''))), 'B')));