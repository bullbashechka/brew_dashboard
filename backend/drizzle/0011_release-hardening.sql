CREATE INDEX "auth_sessions_expires_at_idx" ON "auth"."sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_verifications_expires_at_idx" ON "auth"."verifications" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idempotency_keys_completed_at_idx" ON "app"."idempotency_keys" USING btree ("completed_at");--> statement-breakpoint
REVOKE UPDATE ON TABLE app.app_users, app.networks FROM brew_runtime;--> statement-breakpoint
GRANT UPDATE (last_login_at, tour_completed_at, tour_skipped_at, updated_at) ON TABLE app.app_users TO brew_runtime;--> statement-breakpoint
GRANT UPDATE (name, owner_name, country_code, currency_code, timezone, language, onboarding_completed_at, demo_generator_version, demo_generated_for_date, demo_data_revision, updated_at) ON TABLE app.networks TO brew_runtime;
