-- The application-owned login failure bucket is stored in auth.rate_limits.
-- Keep it available to the auth runtime while Better Auth's own generic rate limiter remains off.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE auth.rate_limits TO brew_auth_runtime;
