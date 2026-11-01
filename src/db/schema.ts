/**
 * Dystopia — schema do banco de dados (Drizzle ORM / PostgreSQL)
 *
 * Domínio: e-commerce de produtos geek (colecionáveis, quadrinhos, games,
 * action figures, roupas, acessórios).
 *
 * Convenções:
 * - Valores monetários são armazenados em CENTAVOS (integer) para evitar
 *   problemas de arredondamento com float.
 * - `slug` é usado nas URLs públicas (/produto/[slug], /categoria/[slug]).
 * - Tabelas de junção/snapshot (orderItems, cartItems) guardam uma cópia do
 *   preço no momento da operação, porque o preço do produto pode mudar depois.
 */

import { relations, sql } from "drizzle-orm";
// Relativo (não `@/`): o drizzle-kit carrega este arquivo sem o alias do tsconfig.
import { PAYMENT_METHODS } from "../services/payments/contract";
import {
  type AnyPgColumn,
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum("user_role", ["customer", "admin"]);

export const orderStatusEnum = pgEnum("order_status", [
  "pending", // criado, aguardando pagamento
  "paid", // pagamento confirmado
  "processing", // separando/embalando
  "shipped", // despachado
  "delivered", // entregue
  "cancelled", // cancelado antes da entrega
  "refunded", // reembolsado
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "authorized",
  "paid",
  "failed",
  "refunded",
]);

// A lista é do contrato de pagamentos: o pedido guarda a forma escolhida, e
// os dois lados falam a mesma língua sem um importar o schema do outro.
export const paymentMethodEnum = pgEnum("payment_method", PAYMENT_METHODS);

export const discountTypeEnum = pgEnum("discount_type", [
  "percentage",
  "fixed",
]);

// ---------------------------------------------------------------------------
// Users & Addresses
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  role: userRoleEnum("role").notNull().default("customer"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex("users_email_unique_idx").on(table.email),
]);

// Sessão no banco (não JWT): sair apaga a linha e o cookie copiado morre junto.
// O cookie leva um token aleatório; aqui fica só o SHA-256 dele — quem lê o
// banco não consegue se passar por ninguém.
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // SHA-256 (hex) do token do cookie
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Senha conferida, falta o código do autenticador: não vale como login.
  mfaPending: boolean("mfa_pending").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("sessions_user_id_idx").on(table.userId),
  index("sessions_expires_at_idx").on(table.expiresAt),
]);

// Segundo fator (TOTP, RFC 6238). Obrigatório para admin.
export const mfaCredentials = pgTable("mfa_credentials", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // Cifrado (AES-256-GCM, chave MFA_ENCRYPTION_KEY) — vazar o banco não
  // entrega o gerador de códigos.
  secret: text("secret").notNull(),
  // null = QR mostrado, código ainda não confirmado (não vale como MFA).
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  // Último passo de 30 s aceito: o mesmo código não entra duas vezes.
  lastUsedStep: integer("last_used_step"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const mfaRecoveryCodes = pgTable("mfa_recovery_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(), // SHA-256 — o código só aparece uma vez, na tela
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("mfa_recovery_codes_user_code_idx").on(table.userId, table.codeHash),
]);

export const addresses = pgTable("addresses", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  label: text("label").notNull().default("Principal"), // "Casa", "Trabalho"...
  recipientName: text("recipient_name").notNull(),
  street: text("street").notNull(),
  number: text("number").notNull(),
  complement: text("complement"),
  neighborhood: text("neighborhood").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(), // UF, ex: "SP"
  zipCode: text("zip_code").notNull(), // CEP
  country: text("country").notNull().default("BR"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  index("addresses_user_id_idx").on(table.userId),
]);

// ---------------------------------------------------------------------------
// Catalog: categories, products, images, variants
// ---------------------------------------------------------------------------

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  // Auto-referência: o tipo de retorno explícito evita a dependência circular
  // que o TypeScript não consegue inferir aqui.
  parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex("categories_slug_unique_idx").on(table.slug),
]);

export type ProductSpec = { label: string; value: string };

/**
 * Documento da busca full-text de um produto: nome, marca e SKU pesam mais
 * (A) que a descrição (B); português (placas → plac) e sem acento
 * (`f_unaccent`, criada na migration 0008 — a `unaccent` pura não é
 * IMMUTABLE e índice exige). Uma definição só, usada pelo índice e pela
 * consulta: é a expressão igual que deixa o Postgres usar o índice. Índice
 * sobre expressão, e não coluna gerada, para o vetor não vir junto em toda
 * consulta de produto.
 */
export function productSearchDocument(t: {
  name: AnyPgColumn;
  brand: AnyPgColumn;
  sku: AnyPgColumn;
  description: AnyPgColumn;
}) {
  return sql`(setweight(to_tsvector('portuguese'::regconfig, f_unaccent(coalesce(${t.name}, '') || ' ' || coalesce(${t.brand}, '') || ' ' || coalesce(${t.sku}, ''))), 'A') || setweight(to_tsvector('portuguese'::regconfig, f_unaccent(coalesce(${t.description}, ''))), 'B'))`;
}

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description").notNull(),
  brand: text("brand"),
  sku: text("sku").notNull(),
  priceCents: integer("price_cents").notNull(),
  compareAtPriceCents: integer("compare_at_price_cents"), // preço "de/por"
  stockQuantity: integer("stock_quantity").notNull().default(0),
  weightGrams: integer("weight_grams"),
  // Ficha técnica, em ordem de exibição: [{ label: "VRAM", value: "12 GB GDDR7" }].
  // Lista (não objeto) porque a ordem importa e o rótulo é texto livre por categoria.
  specs: jsonb("specs").$type<ProductSpec[]>().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  isFeatured: boolean("is_featured").notNull().default(false),
  ratingAverage: decimal("rating_average", { precision: 2, scale: 1 })
    .notNull()
    .default("0"),
  ratingCount: integer("rating_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex("products_slug_unique_idx").on(table.slug),
  index("products_search_idx").using("gin", productSearchDocument(table)),
  uniqueIndex("products_sku_unique_idx").on(table.sku),
  index("products_category_id_idx").on(table.categoryId),
]);

export const productImages = pgTable("product_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  altText: text("alt_text"),
  position: integer("position").notNull().default(0),
}, (table) => [
  index("product_images_product_id_idx").on(table.productId),
]);

// Variantes: ex. tamanho/cor de uma camiseta geek. `attributes` guarda
// pares livres tipo { "size": "M", "color": "Preto" } para não engessar o
// schema em atributos fixos que não fazem sentido para todo produto.
export const productVariants = pgTable("product_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // "M / Preto"
  sku: text("sku").notNull(),
  priceCents: integer("price_cents"), // override; null = usa o do produto
  stockQuantity: integer("stock_quantity").notNull().default(0),
  attributes: jsonb("attributes").notNull().default({}),
}, (table) => [
  uniqueIndex("product_variants_sku_unique_idx").on(table.sku),
  index("product_variants_product_id_idx").on(table.productId),
]);

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

export const carts = pgTable("carts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  sessionToken: text("session_token"), // carrinho de visitante não logado
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  index("carts_user_id_idx").on(table.userId),
  uniqueIndex("carts_session_token_unique_idx").on(table.sessionToken),
]);

export const cartItems = pgTable("cart_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  cartId: uuid("cart_id")
    .notNull()
    .references(() => carts.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id").references(() => productVariants.id, {
    onDelete: "cascade",
  }),
  quantity: integer("quantity").notNull().default(1),
  unitPriceCents: integer("unit_price_cents").notNull(), // snapshot do preço
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  index("cart_items_cart_id_idx").on(table.cartId),
  // Uma linha por (carrinho, produto, variante). NULLS NOT DISTINCT faz
  // produto sem variante (variant_id NULL) contar como repetido também — é o
  // que deixa "adicionar" ser um INSERT ... ON CONFLICT atômico.
  unique("cart_items_cart_product_variant_unique")
    .on(table.cartId, table.productId, table.variantId)
    .nullsNotDistinct(),
]);

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

export const coupons = pgTable("coupons", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull(),
  description: text("description"),
  discountType: discountTypeEnum("discount_type").notNull(),
  discountValue: integer("discount_value").notNull(), // % (0-100) ou centavos
  minOrderCents: integer("min_order_cents").notNull().default(0),
  maxUsage: integer("max_usage"), // null = ilimitado
  usageCount: integer("usage_count").notNull().default(0),
  validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
}, (table) => [
  uniqueIndex("coupons_code_unique_idx").on(table.code),
]);

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderNumber: text("order_number").notNull(), // ex: "DYS-2026-000123"
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  status: orderStatusEnum("status").notNull().default("pending"),
  shippingAddressId: uuid("shipping_address_id")
    .notNull()
    .references(() => addresses.id, { onDelete: "restrict" }),
  billingAddressId: uuid("billing_address_id")
    .notNull()
    .references(() => addresses.id, { onDelete: "restrict" }),
  couponId: uuid("coupon_id").references(() => coupons.id, {
    onDelete: "set null",
  }),
  subtotalCents: integer("subtotal_cents").notNull(),
  shippingCents: integer("shipping_cents").notNull().default(0),
  discountCents: integer("discount_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull(),
  // Resumo do pagamento, como pagamentos respondeu na cobrança aprovada. Os
  // dados da cobrança são do serviço de pagamentos (banco próprio): o pedido
  // guarda só o que mostra ao cliente, gravado pela saga ao confirmar.
  paymentMethod: paymentMethodEnum("payment_method"),
  paymentStatus: paymentStatusEnum("payment_status"),
  paymentProvider: text("payment_provider"),
  paymentTransactionId: text("payment_transaction_id"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex("orders_order_number_unique_idx").on(table.orderNumber),
  index("orders_user_id_idx").on(table.userId),
  index("orders_status_idx").on(table.status),
]);

export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "restrict" }),
  variantId: uuid("variant_id").references(() => productVariants.id, {
    onDelete: "set null",
  }),
  productNameSnapshot: text("product_name_snapshot").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  quantity: integer("quantity").notNull(),
  totalCents: integer("total_cents").notNull(),
}, (table) => [
  index("order_items_order_id_idx").on(table.orderId),
]);

/**
 * Eventos de domínio do pedido: o que aconteceu com ELE, na ordem, em
 * linguagem de negócio (recebido, pago, enviado, cancelado e por quê). Nascem
 * na mesma transação da mudança de status (`services/orders`), e é daqui que o
 * cliente lê o andamento — não do log interno da saga.
 */
export const orderEventTypeEnum = pgEnum("order_event_type", [
  "placed",
  "paid",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
]);

export const orderEvents = pgTable("order_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  type: orderEventTypeEnum("type").notNull(),
  // Detalhe do evento — no cancelamento, `{ reason: "payment_declined" }`.
  data: jsonb("data").notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("order_events_order_id_idx").on(table.orderId, table.occurredAt),
]);

// ---------------------------------------------------------------------------
// Reviews & Wishlist
// ---------------------------------------------------------------------------

export const reviews = pgTable("reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(), // 1-5, validado na app layer
  title: text("title"),
  comment: text("comment"),
  isVerifiedPurchase: boolean("is_verified_purchase").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  index("reviews_product_id_idx").on(table.productId),
  uniqueIndex("reviews_product_user_unique_idx").on(
    table.productId,
    table.userId,
  ),
]);

export const wishlistItems = pgTable("wishlist_items", {
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.productId] }),
]);

// ---------------------------------------------------------------------------
// Orquestração: SAGA + fila durável (ver docs/ARQUITETURA.md)
//
// O checkout não é mais uma transação gigante: é uma SAGA com passos atômicos,
// cada um num serviço próprio (src/services/*), com compensação em ordem
// reversa. Estas tabelas são o estado durável da orquestração:
//
// - `sagas`      → uma instância em execução (qual passo, payload, contexto)
// - `saga_steps` → log por passo (tentativas, saída, erro) = registro de
//                  idempotência: passo `completed` nunca roda de novo
// - `outbox`     → caixa de saída transacional: a mensagem nasce na mesma
//                  transação do fato de negócio e o relay publica no RabbitMQ.
//                  A fila mesmo (entrega, retry, DLQ) é do broker.
// ---------------------------------------------------------------------------

export const sagaStatusEnum = pgEnum("saga_status", [
  "running", // executando os passos
  "completed", // todos os passos confirmados
  "compensating", // falhou; desfazendo o que já tinha sido aplicado
  "compensated", // desfeito com sucesso (pedido cancelado)
  "failed", // a própria compensação falhou — exige intervenção manual
  // Passo depois do ponto sem volta (pivô) não andou: a saga não desfaz nada
  // (o pagamento já foi aprovado) e espera alguém corrigir a causa e retomar.
  "halted",
]);

export const sagaStepStatusEnum = pgEnum("saga_step_status", [
  "pending", // tentado, ainda não confirmado (vai ter retry)
  "waiting", // passo remoto: comando enviado, aguardando a resposta pela fila
  "completed",
  "compensated",
  "failed",
]);

export const sagas = pgTable("sagas", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(), // "checkout"
  correlationId: text("correlation_id").notNull(), // orderNumber — liga saga ↔ domínio
  // Versão da definição com que a saga começou: ela termina nessa versão,
  // mesmo que um deploy mude a ordem dos passos no meio do caminho.
  definitionVersion: integer("definition_version").notNull().default(1),
  status: sagaStatusEnum("status").notNull().default("running"),
  currentStep: integer("current_step").notNull().default(0),
  payload: jsonb("payload").notNull(), // entrada imutável da saga
  context: jsonb("context").notNull().default({}), // saídas acumuladas dos passos
  lastError: text("last_error"),
  // Lease: quem está executando a saga agora e até quando. Garante que dois
  // consumidores (ou uma mensagem repetida) nunca avancem a mesma saga juntos.
  lockedBy: text("locked_by"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [
  index("sagas_status_idx").on(table.status),
  index("sagas_correlation_id_idx").on(table.correlationId),
  index("sagas_lease_until_idx").on(table.leaseUntil),
]);

export const sagaSteps = pgTable("saga_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  sagaId: uuid("saga_id")
    .notNull()
    .references(() => sagas.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // "reserve-stock", "authorize-payment"...
  position: integer("position").notNull(),
  status: sagaStepStatusEnum("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  output: jsonb("output"),
  error: text("error"),
  // Passo remoto `waiting`: até quando a resposta é esperada. Vencido, a
  // reconciliação pergunta o status ao outro serviço (ou reenvia o comando).
  deadlineAt: timestamp("deadline_at", { withTimezone: true }),
  // Quantas vezes o prazo venceu e a saga perguntou — passa de 3, alerta.
  statusChecks: integer("status_checks").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("saga_steps_saga_name_unique_idx").on(table.sagaId, table.name),
  index("saga_steps_deadline_idx").on(table.deadlineAt),
]);

// Outbox: a definição mora em `./outbox` porque o banco de pagamentos tem a
// mesma tabela (cada banco publica a própria caixa de saída).
export { outbox } from "./outbox";

export const notificationStatusEnum = pgEnum("notification_status", [
  "pending", // gravada pelo passo da saga; entrega na fila
  "sent", // provedor aceitou (ou entrega simulada)
  "failed", // recusada de vez pelo provedor (ex.: destinatário inválido)
]);

// Saída do serviço de notificações. `dedupeKey` existe para provar (e testar)
// que o passo é idempotente: reenviar a mesma notificação não duplica linha.
// A entrega é uma mensagem separada (outbox): o e-mail nunca sai de dentro da
// transação do passo — se ela desfizesse, o cliente receberia confirmação de
// um pedido que não existe.
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  channel: text("channel").notNull().default("email"),
  recipient: text("recipient").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  /** Versão HTML montada pelo template do e-mail; nula nas notificações antigas (cai no layout genérico). */
  html: text("html"),
  correlationId: text("correlation_id"), // orderNumber
  dedupeKey: text("dedupe_key").notNull(),
  status: notificationStatusEnum("status").notNull().default("pending"),
  provider: text("provider"), // "resend" | "simulado"
  providerMessageId: text("provider_message_id"),
  /** Para onde foi de fato — difere do `recipient` no modo sandbox (EMAIL_REDIRECT_TO). */
  deliveredTo: text("delivered_to"),
  lastError: text("last_error"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("notifications_dedupe_key_unique_idx").on(table.dedupeKey),
  index("notifications_correlation_id_idx").on(table.correlationId),
]);

// Contador de tentativas por janela fixa (login, cadastro). Mora no banco, não
// em memória, porque em serverless cada instância teria o próprio contador.
// Uma linha por chave ("login:ip:1.2.3.4"); a janela vencida é reaproveitada.
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  hits: integer("hits").notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("rate_limits_window_started_at_idx").on(table.windowStartedAt),
]);

// ---------------------------------------------------------------------------
// Relations (usadas pelo Drizzle query API: db.query.products.findMany({ with: {...} }))
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  addresses: many(addresses),
  orders: many(orders),
  reviews: many(reviews),
  wishlistItems: many(wishlistItems),
  carts: many(carts),
}));

export const addressesRelations = relations(addresses, ({ one }) => ({
  user: one(users, { fields: [addresses.userId], references: [users.id] }),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "category_parent",
  }),
  children: many(categories, { relationName: "category_parent" }),
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  images: many(productImages),
  variants: many(productVariants),
  reviews: many(reviews),
}));

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, {
    fields: [productImages.productId],
    references: [products.id],
  }),
}));

export const productVariantsRelations = relations(
  productVariants,
  ({ one, many }) => ({
    product: one(products, {
      fields: [productVariants.productId],
      references: [products.id],
    }),
    cartItems: many(cartItems),
    orderItems: many(orderItems),
  }),
);

export const cartsRelations = relations(carts, ({ one, many }) => ({
  user: one(users, { fields: [carts.userId], references: [users.id] }),
  items: many(cartItems),
}));

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, { fields: [cartItems.cartId], references: [carts.id] }),
  product: one(products, {
    fields: [cartItems.productId],
    references: [products.id],
  }),
  variant: one(productVariants, {
    fields: [cartItems.variantId],
    references: [productVariants.id],
  }),
}));

export const orderEventsRelations = relations(orderEvents, ({ one }) => ({
  order: one(orders, { fields: [orderEvents.orderId], references: [orders.id] }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  shippingAddress: one(addresses, {
    fields: [orders.shippingAddressId],
    references: [addresses.id],
    relationName: "order_shipping_address",
  }),
  billingAddress: one(addresses, {
    fields: [orders.billingAddressId],
    references: [addresses.id],
    relationName: "order_billing_address",
  }),
  coupon: one(coupons, {
    fields: [orders.couponId],
    references: [coupons.id],
  }),
  items: many(orderItems),
  events: many(orderEvents),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
  variant: one(productVariants, {
    fields: [orderItems.variantId],
    references: [productVariants.id],
  }),
}));


export const reviewsRelations = relations(reviews, ({ one }) => ({
  product: one(products, {
    fields: [reviews.productId],
    references: [products.id],
  }),
  user: one(users, { fields: [reviews.userId], references: [users.id] }),
}));

export const wishlistItemsRelations = relations(wishlistItems, ({ one }) => ({
  user: one(users, { fields: [wishlistItems.userId], references: [users.id] }),
  product: one(products, {
    fields: [wishlistItems.productId],
    references: [products.id],
  }),
}));

// ---------------------------------------------------------------------------
// Serviços: pedidos de orçamento (desenvolvimento, montagem, manutenção,
// formatação). Não passam pelo checkout — serviço sob medida começa por conversa.
// ---------------------------------------------------------------------------

export const serviceKindEnum = pgEnum("service_kind", [
  "desenvolvimento",
  "montagem",
  "manutencao",
  "formatacao",
]);

export const serviceRequestStatusEnum = pgEnum("service_request_status", [
  "novo", // acabou de chegar
  "em_contato", // conversa iniciada
  "fechado", // virou trabalho
  "arquivado", // não seguiu
]);

export const serviceRequests = pgTable("service_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Protocolo legível (DYS-S0001): é o que a pessoa recebe e cita na conversa.
  protocol: text("protocol").notNull(),
  kind: serviceKindEnum("kind").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  details: text("details").notNull(),
  status: serviceRequestStatusEnum("status").notNull().default("novo"),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("service_requests_protocol_unique_idx").on(table.protocol),
  index("service_requests_status_idx").on(table.status),
]);

export const sagasRelations = relations(sagas, ({ many }) => ({
  steps: many(sagaSteps),
}));

export const sagaStepsRelations = relations(sagaSteps, ({ one }) => ({
  saga: one(sagas, { fields: [sagaSteps.sagaId], references: [sagas.id] }),
}));
