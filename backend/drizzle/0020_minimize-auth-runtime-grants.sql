-- Keep the authentication runtime role limited to the operations used by Better Auth and MFA.
REVOKE INSERT, DELETE ON TABLE auth.users FROM brew_auth_runtime;
REVOKE INSERT, UPDATE, DELETE ON TABLE auth.accounts FROM brew_auth_runtime;
REVOKE ALL ON TABLE auth.rate_limits FROM brew_auth_runtime;
