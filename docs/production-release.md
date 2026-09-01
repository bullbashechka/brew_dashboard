# Production release and Demo MVP acceptance

This project has one production environment only: the `brew-dashboard` Worker on the exact
`https://brew-dashboard.bullbashechka.workers.dev` origin and one Railway Hobby PostgreSQL service.
Production uses two cache-disabled Hyperdrive configurations: `AUTH_HYPERDRIVE` connects as
`brew_auth_runtime`, and `APP_HYPERDRIVE` connects as `brew_app_runtime`. The checked-in
`RUNTIME_ROLE_SPLIT_STAGE` records the three-step rollout: A keeps a legacy-compatible binding, B
switches to distinct role bindings, and C is the final state with `brew_runtime` revoked. Do not
create a staging Worker, preview deployment, remote test database, Cron trigger, or custom route.

## Release preparation

1. Authenticate interactively with Cloudflare and Railway. Never paste tokens, database URLs, or
   passwords into chat, source control, shell history, or a tracked file.
2. Inspect the existing Railway project/service and both Hyperdrive configurations. Confirm that
   caching is disabled, `AUTH_HYPERDRIVE` uses only `brew_auth_runtime`, and `APP_HYPERDRIVE` uses
   only `brew_app_runtime`. Confirm both roles are `NOBYPASSRLS`, non-owner and have no login until
   the role-provisioning step.
3. Discover the exact Worker URL and set `vars.BETTER_AUTH_URL` in `wrangler.jsonc` to its HTTPS
   origin. It is non-secret configuration; `BETTER_AUTH_SECRET` is a Cloudflare secret.
4. Apply migrations through the owner connection injected by Railway. This is release stage A;
   deploy no Worker until the migration succeeds:

   ```bash
   ALLOW_PRODUCTION_MIGRATIONS=1 railway run --project <project-id> --environment <environment> --service <postgres-service> --no-local -- bun run db:migrate
   ```

5. Provision the two runtime role passwords through a protected secret manager, then update
   `wrangler.jsonc` to stage B with two distinct Hyperdrive IDs:

   ```bash
   ALLOW_PRODUCTION_MIGRATIONS=1 railway run --project <project-id> --environment <environment> --service <postgres-service> --no-local -- bun run db:provision-runtime-roles
   ```

   `AUTH_RUNTIME_DATABASE_PASSWORD` and `APP_RUNTIME_DATABASE_PASSWORD` must not appear in shell
   history, process arguments, logs or tracked files. Confirm the two roles with a read-only owner
   query, then create/update the two cache-disabled Hyperdrive configurations with those roles.

6. Set `RUNTIME_ROLE_SPLIT_STAGE=B` and deploy the rollback-safe split-binding Worker while
   `brew_runtime` is still active:

   ```bash
   bun run release:deploy-stage-b -- --confirm-production production
   ```

   This command verifies the build, confirms `BETTER_AUTH_SECRET`, runs the exact-grant/RLS smoke
   with `legacyRuntimeRevoked: false`, and only then deploys. Confirm health, password login, MFA and
   representative application reads on this Stage B Worker. Record this Worker version: it is the
   rollback target for Stage C. Do not revoke `brew_runtime` until Stage B is live and healthy.

7. Set `RUNTIME_ROLE_SPLIT_STAGE=C`, revoke the legacy role, and run the final gate:

   ```bash
   ALLOW_PRODUCTION_MIGRATIONS=1 railway run --project <project-id> --environment <environment> --service <postgres-service> --no-local -- bun run db:revoke-legacy-runtime -- --confirm-production production
   ```

   Confirm that smoke reports `legacyRuntimeRevoked: true`. `release:deploy` refuses stages A and B
   and deploys only stage C through the generated
   Vite config:

   ```bash
   bun run release:deploy -- --confirm-production production
   ```

   `release:deploy` runs `release:verify`, fail-closed confirms that `BETTER_AUTH_SECRET` exists,
   then runs a fresh `db:smoke:hyperdrive`, and deploys only if every role, exact grant, RLS,
   migration-head and `legacyRuntimeRevoked` invariant is true. A timeout, malformed response,
   unavailable secret list/smoke, missing secret, or any false invariant blocks deploy.

   For a Worker that already exists but has never had `BETTER_AUTH_SECRET`, bootstrap it once before
   release. This command refuses an existing secret and creates a version without deploying it:

   ```bash
   bun run release:bootstrap-auth-secret -- --confirm-production production
   ```

   Do not use bootstrap for rotation. Rotation requires preserving the prior key for rollback,
   revoking all sessions, and a controlled migration or reset of MFA material encrypted with the old
   key before promoting the new Worker version. Record that procedure as a separate incident/change.

8. Confirm `GET /api/v1/health`, SPA fallback, API JSON 404 responses, configured secret name and
   structured Worker logs. If a post-deploy check fails, rollback to the recorded Stage B version;
   do not rollback to a legacy Stage A Worker after `brew_runtime` has been revoked.
   A first-ever deployment has no rollback target: do not issue access and fix forward.

## Production acceptance and cleanup

Create one temporary account, never a demo account. The admin command generates a one-time password
and prints it once; transfer it directly to the acceptance runner without saving it to a file.

```bash
ALLOW_PRODUCTION_ADMIN=1 railway run --project <project-id> --environment <environment> --service <postgres-service> --no-local -- bun run admin:create-user -- --login stage13-acceptance --account-kind e2e --expires-at <future-utc-timestamp> --confirm-production production
```

The account must be fresh or have MFA reset before each acceptance run because the guarded browser
journey provisions TOTP and never accepts a pre-existing authenticator secret. For a deliberately
reused e2e account, reset only that account first:

```bash
ALLOW_PRODUCTION_ADMIN=1 railway run --project <project-id> --environment <environment> --service <postgres-service> --no-local -- bun run admin:reset-mfa -- --login stage13-acceptance --account-kind e2e --confirm-login stage13-acceptance --confirm-production production
```

Run the full production journey. The runner accepts only the exact `workers.dev` origin and checks
the selected account kind before it opens a browser; browser traces, screenshots and video are off.

```bash
PRODUCTION_E2E_BASE_URL=<exact-workers-url> ALLOW_PRODUCTION_ADMIN=1 railway run --project <project-id> --environment <environment> --service <postgres-service> --no-local -- bun run test:e2e:production -- --login stage13-acceptance --confirm-production production
```

The journey covers health, login, mandatory MFA/TOTP enrollment, onboarding, all product sections,
filters, three mutation groups, feedback, reset, RU/EN, mobile layout and out-of-scope UI. Tenant
isolation remains covered by the two-tenant Stage 12 system E2E; the production journey
intentionally uses one account only.

After a successful run, delete only that explicit account and its tenant data:

```bash
ALLOW_PRODUCTION_ADMIN=1 railway run --project <project-id> --environment <environment> --service <postgres-service> --no-local -- bun run admin:delete-user -- --login stage13-acceptance --account-kind e2e --confirm-login stage13-acceptance --confirm-production production
```

Run the encrypted backup job daily and complete the monthly restore drill described in
[`backup-recovery.md`](backup-recovery.md) before declaring production ready. A missing backup,
failed artifact verification, role mismatch, or unverified Hyperdrive connection is a release
blocker.

## Issuing demo access

Do not populate unused demo accounts. When a recipient is selected, create their `demo` account
through the protected admin command, copy its one-time generated password directly to an approved
password manager or secure delivery channel, and record invitation date, recipient, and response.
The service enforces a maximum of 15 active demo accounts. Track the first three explicit requests
for a discussion or pilot; that is the Demo MVP outcome signal, not a deployment precondition.
