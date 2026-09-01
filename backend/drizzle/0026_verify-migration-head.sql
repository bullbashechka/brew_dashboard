-- A no-argument SECURITY DEFINER probe lets the unprivileged runtime connection prove that the
-- Drizzle journal reached this migration without granting it SELECT on migration metadata.
CREATE OR REPLACE FUNCTION app.security_migration_head_applied()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, drizzle
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM drizzle.__drizzle_migrations
    WHERE created_at >= 1788115621804
  );
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.security_migration_head_applied() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.security_migration_head_applied() TO brew_app_runtime;
