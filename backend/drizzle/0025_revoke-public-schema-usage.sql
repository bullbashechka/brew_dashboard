-- Runtime roles receive only the schema they need; PUBLIC must not reach either protected schema.
REVOKE ALL ON SCHEMA app, auth FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON SCHEMA app, auth FROM brew_auth_runtime, brew_app_runtime;--> statement-breakpoint
GRANT USAGE ON SCHEMA auth TO brew_auth_runtime;--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO brew_app_runtime;
