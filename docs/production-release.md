# Production release and Demo MVP acceptance

This project has one production environment only: the `brew-dashboard` Worker on `workers.dev`,
one Railway Hobby PostgreSQL service, and one cache-disabled Hyperdrive binding. Do not create a
staging Worker, preview deployment, remote test database, Cron trigger, or custom route.

## Release preparation

1. Authenticate interactively with Cloudflare and Railway. Never paste tokens, database URLs, or
   passwords into chat, source control, shell history, or a tracked file.
2. Inspect the existing Railway project/service and the configured Hyperdrive binding. Confirm that
   Hyperdrive is cache-disabled and uses the non-owner `brew_runtime` role.
3. Discover the exact Worker URL and set `vars.BETTER_AUTH_URL` in `wrangler.jsonc` to its HTTPS
   origin. It is non-secret configuration; `BETTER_AUTH_SECRET` is a Cloudflare secret.
4. Commit release preparation, then run `bun run release:verify` from that clean worktree.
5. Apply migrations through the owner connection injected by Railway, then verify the data plane:

   ```bash
   ALLOW_PRODUCTION_MIGRATIONS=1 railway run --project <project-id> --environment <environment> --service <postgres-service> --no-local -- bun run db:migrate
   bun run db:smoke:hyperdrive
   ```

6. Record the prior Worker version if present. Deploy through the generated Vite config:

   ```bash
   bun run release:deploy -- --confirm-production production [--provision-auth-secret]
   ```

   Supply `--provision-auth-secret` only when `BETTER_AUTH_SECRET` does not already exist. The
   command creates that value only in a protected temporary file and removes it after the atomic
   deploy. Existing secrets are preserved by Wrangler deployment.

7. Confirm `GET /api/v1/health`, SPA fallback, API JSON 404 responses, configured secret name and
   structured Worker logs. If a post-deploy check fails, rollback to the recorded prior version.
   A first-ever deployment has no rollback target: do not issue access and fix forward.

## Production acceptance and cleanup

Create one temporary account, never a demo account, using an interactive password prompt. The
password is not echoed by the command and must be retained only long enough for the acceptance run.

```bash
ALLOW_PRODUCTION_ADMIN=1 railway run --project <project-id> --environment <environment> --service <postgres-service> --no-local -- bun run admin:create-user -- --login stage13-acceptance --account-kind e2e --expires-at <future-utc-timestamp> --interactive-password --confirm-production production
```

Run the full production journey. The runner accepts only the exact `workers.dev` origin and checks
the selected account kind before it opens a browser; browser traces, screenshots and video are off.

```bash
PRODUCTION_E2E_BASE_URL=<exact-workers-url> ALLOW_PRODUCTION_ADMIN=1 railway run --project <project-id> --environment <environment> --service <postgres-service> --no-local -- bun run test:e2e:production -- --login stage13-acceptance --confirm-production production
```

The journey covers health, login, onboarding, all product sections, filters, three mutation groups,
feedback, reset, RU/EN, mobile layout and out-of-scope UI. Tenant isolation remains covered by the
two-tenant Stage 12 system E2E; the production journey intentionally uses one account only.

After a successful run, delete only that explicit account and its tenant data:

```bash
ALLOW_PRODUCTION_ADMIN=1 railway run --project <project-id> --environment <environment> --service <postgres-service> --no-local -- bun run admin:delete-user -- --login stage13-acceptance --account-kind e2e --confirm-login stage13-acceptance --confirm-production production
```

## Issuing demo access

Do not populate unused demo accounts. When a recipient is selected, create their `demo` account
through the protected admin command, copy its one-time generated password directly to an approved
password manager or secure delivery channel, and record invitation date, recipient, and response.
The service enforces a maximum of 15 active demo accounts. Track the first three explicit requests
for a discussion or pilot; that is the Demo MVP outcome signal, not a deployment precondition.
