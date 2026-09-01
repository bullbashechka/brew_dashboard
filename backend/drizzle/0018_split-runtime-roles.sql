DO $$
BEGIN
  CREATE ROLE brew_auth_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint

DO $$
BEGIN
  CREATE ROLE brew_app_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint

ALTER ROLE brew_auth_runtime NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS NOLOGIN;--> statement-breakpoint
ALTER ROLE brew_app_runtime NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS NOLOGIN;--> statement-breakpoint

REVOKE ALL ON ALL TABLES IN SCHEMA app, auth FROM brew_auth_runtime, brew_app_runtime;--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app, auth FROM brew_auth_runtime, brew_app_runtime;--> statement-breakpoint
GRANT USAGE ON SCHEMA auth TO brew_auth_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE auth.users, auth.accounts, auth.sessions, auth.verifications, auth.rate_limits, auth.two_factor TO brew_auth_runtime;--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO brew_app_runtime;--> statement-breakpoint
GRANT SELECT ON TABLE app.app_users, app.networks TO brew_app_runtime;--> statement-breakpoint
GRANT UPDATE (last_login_at, tour_completed_at, tour_skipped_at, updated_at) ON TABLE app.app_users TO brew_app_runtime;--> statement-breakpoint
GRANT UPDATE (name, owner_name, country_code, currency_code, timezone, language, onboarding_completed_at, demo_generator_version, demo_generated_for_date, demo_data_revision, updated_at) ON TABLE app.networks TO brew_app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE app.locations, app.demo_generations, app.product_events TO brew_app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE app.categories, app.orders, app.order_items, app.inventory_items TO brew_app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE app.products, app.revenue_targets, app.idempotency_keys TO brew_app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE app.feedback_responses TO brew_app_runtime;--> statement-breakpoint
GRANT SELECT ON TABLE app.inventory_balances, app.inventory_movements TO brew_app_runtime;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.apply_inventory_movement(uuid, uuid, app.movement_type, numeric, varchar, uuid, timestamptz) TO brew_app_runtime;--> statement-breakpoint

ALTER DEFAULT PRIVILEGES IN SCHEMA app, auth REVOKE ALL ON TABLES FROM brew_auth_runtime, brew_app_runtime;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA app, auth REVOKE ALL ON SEQUENCES FROM brew_auth_runtime, brew_app_runtime;
