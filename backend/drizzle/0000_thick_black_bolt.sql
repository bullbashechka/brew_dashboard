CREATE SCHEMA IF NOT EXISTS "auth";--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "app";--> statement-breakpoint
CREATE TYPE "app"."account_kind" AS ENUM('demo', 'e2e');--> statement-breakpoint
CREATE TYPE "app"."account_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "app"."inventory_unit" AS ENUM('pcs', 'kg', 'l');--> statement-breakpoint
CREATE TYPE "app"."language" AS ENUM('en', 'ru');--> statement-breakpoint
CREATE TYPE "app"."movement_type" AS ENUM('receipt', 'writeoff');--> statement-breakpoint
CREATE TYPE "app"."order_status" AS ENUM('completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "app"."product_event_type" AS ENUM('login_succeeded', 'onboarding_completed', 'section_viewed', 'filter_changed', 'product_price_changed', 'inventory_movement_created', 'revenue_goal_changed', 'demo_reset', 'feedback_submitted');--> statement-breakpoint
CREATE TABLE "app"."app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" text NOT NULL,
	"login_normalized" varchar(64) NOT NULL,
	"network_id" uuid NOT NULL,
	"status" "app"."account_status" DEFAULT 'active' NOT NULL,
	"account_kind" "app"."account_kind" DEFAULT 'demo' NOT NULL,
	"expires_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"tour_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_users_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "app_users_login_normalized_unique" UNIQUE("login_normalized"),
	CONSTRAINT "app_users_network_id_unique" UNIQUE("network_id"),
	CONSTRAINT "app_users_network_id_id_unique" UNIQUE("network_id","id"),
	CONSTRAINT "app_users_login_format_check" CHECK ("app"."app_users"."login_normalized" ~ '^[a-z0-9._-]{3,64}$')
);
--> statement-breakpoint
CREATE TABLE "auth"."accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth"."users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"username" text,
	"display_username" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "auth"."verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_network_id_id_unique" UNIQUE("network_id","id")
);
--> statement-breakpoint
ALTER TABLE "app"."categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."demo_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"generated_for_date" date NOT NULL,
	"seed" bigint NOT NULL,
	"version" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_generations_network_id_id_unique" UNIQUE("network_id","id")
);
--> statement-breakpoint
ALTER TABLE "app"."demo_generations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."feedback_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"comment" varchar(2000) DEFAULT '' NOT NULL,
	"desired_features" varchar(2000) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_responses_network_id_unique" UNIQUE("network_id"),
	CONSTRAINT "feedback_responses_network_id_id_unique" UNIQUE("network_id","id"),
	CONSTRAINT "feedback_responses_rating_check" CHECK ("app"."feedback_responses"."rating" between 1 and 5),
	CONSTRAINT "feedback_responses_desired_features_check" CHECK (char_length("app"."feedback_responses"."desired_features") between 1 and 2000),
	CONSTRAINT "feedback_responses_version_positive_check" CHECK ("app"."feedback_responses"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "app"."feedback_responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"key" uuid NOT NULL,
	"operation" varchar(64) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"resource_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_network_key_unique" UNIQUE("network_id","key"),
	CONSTRAINT "idempotency_keys_hash_format_check" CHECK ("app"."idempotency_keys"."request_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "app"."idempotency_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."inventory_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"on_hand" numeric(14, 3) NOT NULL,
	"min_threshold" numeric(14, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_balances_network_id_id_unique" UNIQUE("network_id","id"),
	CONSTRAINT "inventory_balances_location_item_unique" UNIQUE("network_id","location_id","inventory_item_id"),
	CONSTRAINT "inventory_balances_on_hand_nonnegative_check" CHECK ("app"."inventory_balances"."on_hand" >= 0),
	CONSTRAINT "inventory_balances_min_threshold_nonnegative_check" CHECK ("app"."inventory_balances"."min_threshold" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."inventory_balances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"unit" "app"."inventory_unit" NOT NULL,
	"product_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_network_id_id_unique" UNIQUE("network_id","id")
);
--> statement-breakpoint
ALTER TABLE "app"."inventory_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"type" "app"."movement_type" NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_network_id_id_unique" UNIQUE("network_id","id"),
	CONSTRAINT "inventory_movements_quantity_positive_check" CHECK ("app"."inventory_movements"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"name_normalized" varchar(80) NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_network_id_id_unique" UNIQUE("network_id","id"),
	CONSTRAINT "locations_network_name_normalized_unique" UNIQUE("network_id","name_normalized")
);
--> statement-breakpoint
ALTER TABLE "app"."locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."networks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80),
	"owner_name" varchar(80),
	"country_code" varchar(2),
	"currency_code" varchar(3),
	"timezone" text,
	"language" "app"."language",
	"onboarding_completed_at" timestamp with time zone,
	"demo_generator_version" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "networks_country_code_format_check" CHECK ("app"."networks"."country_code" is null or "app"."networks"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "networks_currency_code_format_check" CHECK ("app"."networks"."currency_code" is null or "app"."networks"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "networks_name_length_check" CHECK ("app"."networks"."name" is null or char_length(btrim("app"."networks"."name")) between 2 and 80),
	CONSTRAINT "networks_owner_name_length_check" CHECK ("app"."networks"."owner_name" is null or char_length(btrim("app"."networks"."owner_name")) between 2 and 80)
);
--> statement-breakpoint
ALTER TABLE "app"."networks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price_at_sale" numeric(14, 2) NOT NULL,
	"unit_cost_at_sale" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_network_id_id_unique" UNIQUE("network_id","id"),
	CONSTRAINT "order_items_quantity_positive_check" CHECK ("app"."order_items"."quantity" > 0),
	CONSTRAINT "order_items_unit_price_nonnegative_check" CHECK ("app"."order_items"."unit_price_at_sale" >= 0),
	CONSTRAINT "order_items_unit_cost_nonnegative_check" CHECK ("app"."order_items"."unit_cost_at_sale" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"ordered_at" timestamp with time zone NOT NULL,
	"status" "app"."order_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_network_id_id_unique" UNIQUE("network_id","id")
);
--> statement-breakpoint
ALTER TABLE "app"."orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."product_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"network_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "app"."product_event_type" NOT NULL,
	"route" varchar(32),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_events_network_id_id_unique" UNIQUE("network_id","id")
);
--> statement-breakpoint
ALTER TABLE "app"."product_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"current_price" numeric(14, 2) NOT NULL,
	"current_unit_cost" numeric(14, 2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_network_id_id_unique" UNIQUE("network_id","id"),
	CONSTRAINT "products_current_price_nonnegative_check" CHECK ("app"."products"."current_price" >= 0),
	CONSTRAINT "products_current_unit_cost_nonnegative_check" CHECK ("app"."products"."current_unit_cost" >= 0),
	CONSTRAINT "products_version_positive_check" CHECK ("app"."products"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "app"."products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."revenue_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" uuid NOT NULL,
	"month" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revenue_targets_network_id_id_unique" UNIQUE("network_id","id"),
	CONSTRAINT "revenue_targets_network_month_unique" UNIQUE("network_id","month"),
	CONSTRAINT "revenue_targets_month_start_check" CHECK ("app"."revenue_targets"."month" = date_trunc('month', "app"."revenue_targets"."month")::date),
	CONSTRAINT "revenue_targets_amount_positive_check" CHECK ("app"."revenue_targets"."amount" > 0),
	CONSTRAINT "revenue_targets_version_positive_check" CHECK ("app"."revenue_targets"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "app"."revenue_targets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."app_users" ADD CONSTRAINT "app_users_auth_user_id_users_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."app_users" ADD CONSTRAINT "app_users_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "app"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."categories" ADD CONSTRAINT "categories_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "app"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."demo_generations" ADD CONSTRAINT "demo_generations_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "app"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."feedback_responses" ADD CONSTRAINT "feedback_responses_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "app"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."idempotency_keys" ADD CONSTRAINT "idempotency_keys_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "app"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_balances" ADD CONSTRAINT "inventory_balances_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "app"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_balances" ADD CONSTRAINT "inventory_balances_network_location_fk" FOREIGN KEY ("network_id","location_id") REFERENCES "app"."locations"("network_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_balances" ADD CONSTRAINT "inventory_balances_network_item_fk" FOREIGN KEY ("network_id","inventory_item_id") REFERENCES "app"."inventory_items"("network_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_items" ADD CONSTRAINT "inventory_items_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "app"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_items" ADD CONSTRAINT "inventory_items_network_product_fk" FOREIGN KEY ("network_id","product_id") REFERENCES "app"."products"("network_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ADD CONSTRAINT "inventory_movements_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "app"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ADD CONSTRAINT "inventory_movements_network_location_fk" FOREIGN KEY ("network_id","location_id") REFERENCES "app"."locations"("network_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."inventory_movements" ADD CONSTRAINT "inventory_movements_network_item_fk" FOREIGN KEY ("network_id","inventory_item_id") REFERENCES "app"."inventory_items"("network_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."locations" ADD CONSTRAINT "locations_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "app"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_items" ADD CONSTRAINT "order_items_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "app"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_items" ADD CONSTRAINT "order_items_network_order_fk" FOREIGN KEY ("network_id","order_id") REFERENCES "app"."orders"("network_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_items" ADD CONSTRAINT "order_items_network_product_fk" FOREIGN KEY ("network_id","product_id") REFERENCES "app"."products"("network_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "app"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_network_location_fk" FOREIGN KEY ("network_id","location_id") REFERENCES "app"."locations"("network_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."product_events" ADD CONSTRAINT "product_events_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "app"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."product_events" ADD CONSTRAINT "product_events_network_user_fk" FOREIGN KEY ("network_id","user_id") REFERENCES "app"."app_users"("network_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."products" ADD CONSTRAINT "products_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "app"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."products" ADD CONSTRAINT "products_network_category_fk" FOREIGN KEY ("network_id","category_id") REFERENCES "app"."categories"("network_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."revenue_targets" ADD CONSTRAINT "revenue_targets_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "app"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_users_status_expiry_idx" ON "app"."app_users" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "auth_accounts_user_id_idx" ON "auth"."accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_accounts_issuer_account_id_uidx" ON "auth"."accounts" USING btree ("issuer","account_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_id_idx" ON "auth"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_idx" ON "auth"."verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "categories_network_id_idx" ON "app"."categories" USING btree ("network_id");--> statement-breakpoint
CREATE INDEX "demo_generations_network_date_idx" ON "app"."demo_generations" USING btree ("network_id","generated_for_date");--> statement-breakpoint
CREATE INDEX "inventory_balances_network_id_idx" ON "app"."inventory_balances" USING btree ("network_id");--> statement-breakpoint
CREATE INDEX "inventory_items_network_id_idx" ON "app"."inventory_items" USING btree ("network_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_network_occurred_idx" ON "app"."inventory_movements" USING btree ("network_id","occurred_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_network_location_occurred_idx" ON "app"."inventory_movements" USING btree ("network_id","location_id","occurred_at");--> statement-breakpoint
CREATE INDEX "locations_network_id_idx" ON "app"."locations" USING btree ("network_id");--> statement-breakpoint
CREATE INDEX "order_items_network_id_idx" ON "app"."order_items" USING btree ("network_id");--> statement-breakpoint
CREATE INDEX "orders_network_occurred_idx" ON "app"."orders" USING btree ("network_id","ordered_at");--> statement-breakpoint
CREATE INDEX "orders_network_location_occurred_idx" ON "app"."orders" USING btree ("network_id","location_id","ordered_at");--> statement-breakpoint
CREATE INDEX "product_events_network_occurred_idx" ON "app"."product_events" USING btree ("network_id","occurred_at");--> statement-breakpoint
CREATE INDEX "products_network_id_idx" ON "app"."products" USING btree ("network_id");--> statement-breakpoint
CREATE POLICY "categories_tenant_isolation" ON "app"."categories" AS PERMISSIVE FOR ALL TO public USING ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid) WITH CHECK ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "demo_generations_tenant_isolation" ON "app"."demo_generations" AS PERMISSIVE FOR ALL TO public USING ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid) WITH CHECK ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "feedback_responses_tenant_isolation" ON "app"."feedback_responses" AS PERMISSIVE FOR ALL TO public USING ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid) WITH CHECK ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "idempotency_keys_tenant_isolation" ON "app"."idempotency_keys" AS PERMISSIVE FOR ALL TO public USING ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid) WITH CHECK ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "inventory_balances_tenant_isolation" ON "app"."inventory_balances" AS PERMISSIVE FOR ALL TO public USING ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid) WITH CHECK ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "inventory_items_tenant_isolation" ON "app"."inventory_items" AS PERMISSIVE FOR ALL TO public USING ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid) WITH CHECK ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "inventory_movements_tenant_isolation" ON "app"."inventory_movements" AS PERMISSIVE FOR ALL TO public USING ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid) WITH CHECK ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "locations_tenant_isolation" ON "app"."locations" AS PERMISSIVE FOR ALL TO public USING ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid) WITH CHECK ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "networks_tenant_isolation" ON "app"."networks" AS PERMISSIVE FOR ALL TO public USING ("id" = nullif(current_setting('app.network_id', true), '')::uuid) WITH CHECK ("id" = nullif(current_setting('app.network_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "order_items_tenant_isolation" ON "app"."order_items" AS PERMISSIVE FOR ALL TO public USING ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid) WITH CHECK ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "orders_tenant_isolation" ON "app"."orders" AS PERMISSIVE FOR ALL TO public USING ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid) WITH CHECK ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "product_events_tenant_isolation" ON "app"."product_events" AS PERMISSIVE FOR ALL TO public USING ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid) WITH CHECK ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "products_tenant_isolation" ON "app"."products" AS PERMISSIVE FOR ALL TO public USING ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid) WITH CHECK ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "revenue_targets_tenant_isolation" ON "app"."revenue_targets" AS PERMISSIVE FOR ALL TO public USING ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid) WITH CHECK ("network_id" = nullif(current_setting('app.network_id', true), '')::uuid);
