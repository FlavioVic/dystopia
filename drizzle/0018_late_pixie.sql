ALTER TABLE "addresses" ALTER COLUMN "label" SET DATA TYPE varchar(60);--> statement-breakpoint
ALTER TABLE "addresses" ALTER COLUMN "label" SET DEFAULT 'Principal';--> statement-breakpoint
ALTER TABLE "addresses" ALTER COLUMN "recipient_name" SET DATA TYPE varchar(200);--> statement-breakpoint
ALTER TABLE "addresses" ALTER COLUMN "street" SET DATA TYPE varchar(200);--> statement-breakpoint
ALTER TABLE "addresses" ALTER COLUMN "number" SET DATA TYPE varchar(200);--> statement-breakpoint
ALTER TABLE "addresses" ALTER COLUMN "complement" SET DATA TYPE varchar(200);--> statement-breakpoint
ALTER TABLE "addresses" ALTER COLUMN "neighborhood" SET DATA TYPE varchar(200);--> statement-breakpoint
ALTER TABLE "addresses" ALTER COLUMN "city" SET DATA TYPE varchar(200);--> statement-breakpoint
ALTER TABLE "addresses" ALTER COLUMN "state" SET DATA TYPE varchar(2);--> statement-breakpoint
ALTER TABLE "addresses" ALTER COLUMN "zip_code" SET DATA TYPE varchar(9);--> statement-breakpoint
ALTER TABLE "addresses" ALTER COLUMN "country" SET DATA TYPE varchar(2);--> statement-breakpoint
ALTER TABLE "addresses" ALTER COLUMN "country" SET DEFAULT 'BR';--> statement-breakpoint
ALTER TABLE "coupons" ALTER COLUMN "code" SET DATA TYPE varchar(20);--> statement-breakpoint
ALTER TABLE "coupons" ALTER COLUMN "description" SET DATA TYPE varchar(200);--> statement-breakpoint
ALTER TABLE "product_variants" ALTER COLUMN "name" SET DATA TYPE varchar(200);--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "name" SET DATA TYPE varchar(200);--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "slug" SET DATA TYPE varchar(120);--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "description" SET DATA TYPE varchar(2000);--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "brand" SET DATA TYPE varchar(200);--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "sku" SET DATA TYPE varchar(200);--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "title" SET DATA TYPE varchar(80);--> statement-breakpoint
ALTER TABLE "reviews" ALTER COLUMN "comment" SET DATA TYPE varchar(1000);--> statement-breakpoint
ALTER TABLE "service_requests" ALTER COLUMN "name" SET DATA TYPE varchar(120);--> statement-breakpoint
ALTER TABLE "service_requests" ALTER COLUMN "email" SET DATA TYPE varchar(254);--> statement-breakpoint
ALTER TABLE "service_requests" ALTER COLUMN "phone" SET DATA TYPE varchar(20);--> statement-breakpoint
ALTER TABLE "service_requests" ALTER COLUMN "details" SET DATA TYPE varchar(2000);--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" SET DATA TYPE varchar(254);--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "name" SET DATA TYPE varchar(120);--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "phone" SET DATA TYPE varchar(20);