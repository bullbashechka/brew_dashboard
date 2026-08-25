# Brew Dashboard

Bun monorepo for the Brew Dashboard MVP. The active application surfaces are:

- `webapp/` — React, TypeScript, Vite and Playwright client;
- `backend/` — Hono API and its current server-side foundation;
- `packages/contracts/` — shared Zod schemas and TypeScript API contracts.
- Docker Compose + PostgreSQL 16 — local-only isolated database for integration tests.

Product intent and architecture live in [PRD.md](PRD.md); implementation stages and acceptance criteria live in [TASKS.md](TASKS.md).

Install and validate with the repository-pinned Bun version:

```bash
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run test:integration
bun run test:e2e
bun run build
```

Run the local single-origin Worker and SPA with:

```bash
bun run dev
```

The Vite Cloudflare plugin starts the React shell and Hono Worker together. `GET /api/v1/health`
is served by the Worker, `/api/*` stays on the Worker path, and unknown browser routes use the SPA
fallback. Playwright needs its local browser installed once with `bunx playwright install chromium`.

Local Worker variables are documented in [.dev.vars.example](.dev.vars.example); keep real values
in the ignored `.dev.vars` file. The target persistence path is a cache-disabled Cloudflare
Hyperdrive binding backed by Railway PostgreSQL. Railway's `DATABASE_PUBLIC_URL` is used only to
create that binding and by local migration/admin commands; it is never a Vite variable or Worker
environment value. `BETTER_AUTH_SECRET` remains server-only.

For local Hyperdrive development, provide
`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` in the shell environment rather than
committing a connection string. The production `HYPERDRIVE` binding is configured in
`wrangler.jsonc`; Stage 3 opens a request-scoped connection through that cache-disabled binding.

## Local integration database

Following the local-development convention used by the
[Vibe Coding Template](https://github.com/di-sukharev/vibe), Docker Compose is the default
PostgreSQL path for this repository's database-backed tests. It is deliberately limited to a
loopback-only, disposable test service; production remains Cloudflare Hyperdrive backed by Railway
and does not use Docker.

Run the isolated integration suite (the command starts the database and waits for it):

```bash
bun run test:integration:docker
```

The runner creates a random database, applies migrations, creates the temporary `brew_runtime`
role, and removes all three afterwards. The Compose service accepts passwordless connections only
on `127.0.0.1` to avoid tracking local credentials; do not expose its port or use it outside local
development. Stop it with `docker compose down`; use `docker compose down -v` only when an
intentional full reset of this disposable test database is needed.

The repository intentionally contains only the active `webapp`, `backend` and
`packages/contracts` workspaces. Product screens and business API flows are introduced by later
stages in `TASKS.md`; Stage 3 adds server-only Better Auth sessions and account administration.

## Authentication and account administration (Stage 3)

The Worker exposes only the application auth routes `POST /api/v1/auth/login`,
`POST /api/v1/auth/logout` and `GET /api/v1/auth/me`. Better Auth's internal handler is mounted
under a non-public path and is not routed by the Worker. Sessions are database-backed opaque
cookies; signup, recovery, email confirmation and user-facing password changes are disabled.
Mutating requests must be same-origin JSON and are limited to 256 KiB.

Admin commands use the owner/unpooled database URL, never the runtime Hyperdrive role. Login aliases
are normalized to lowercase and must contain 3–64 Latin letters, digits, `.`, `_` or `-`. A generated
password is printed once only; use `--interactive-password` to enter one without putting it in shell
history. Production commands additionally require the explicit environment/confirmation gate.

```bash
DATABASE_MIGRATION_URL='postgresql://owner@localhost/brew_dashboard' \
  bun run admin:create-user -- --login demo.owner

DATABASE_MIGRATION_URL='postgresql://owner@localhost/brew_dashboard' \
  bun run admin:create-user -- --login test.owner --account-kind e2e --interactive-password

DATABASE_MIGRATION_URL='postgresql://owner@localhost/brew_dashboard' \
  bun run admin:reset-password -- --login demo.owner --account-kind demo --confirm-login demo.owner

DATABASE_MIGRATION_URL='postgresql://owner@localhost/brew_dashboard' \
  bun run admin:disable-user -- --login demo.owner --account-kind demo --confirm-login demo.owner

DATABASE_MIGRATION_URL='postgresql://owner@localhost/brew_dashboard' \
  bun run admin:delete-user -- --login test.owner --account-kind e2e --confirm-login test.owner
```

The default `demo` kind is capped at 15 active accounts; `e2e` accounts are excluded from that
limit. Deletion is intentionally explicit and cascades the selected account's empty network and
business data. Do not place database URLs, Better Auth secrets, passwords or generated output in
tracked files or logs.

## First run and guided tour (Stage 7)

After sign-in, an account without configuration follows the required flow `Language → Onboarding →
Overview`. The onboarding form accepts 1–5 case-insensitively unique location names and validates
network, owner, ISO country/currency, and IANA timezone values through the shared contracts.

The first completed onboarding opens a three-step guided tour. It can be completed, skipped, or
started again from Settings; `PUT /api/v1/settings/tour` persists `pending`, `completed`, or
`skipped` with the existing idempotency-key boundary. The `tour_skipped_at` migration must be
applied before deploying this stage.

## Database workflow (Stage 2)

`backend/src/db/schema.ts` is the server-only source of database types. Drizzle generates the
versioned SQL in `backend/drizzle/`; applied migrations must never be edited in place.

```bash
bun run db:check
bun run db:generate
DATABASE_MIGRATION_URL='postgresql://owner@localhost/brew_dashboard' bun run db:migrate
```

`DATABASE_MIGRATION_URL` (or `DATABASE_PUBLIC_URL`) must be an owner/unpooled connection. Before
the Worker can use Hyperdrive, apply the migrations and provision the separate non-owner role.
Set `RUNTIME_DATABASE_PASSWORD` and `DATABASE_MIGRATION_URL` through an interactive prompt or a
local secret manager, then run:

```bash
bun run --cwd backend db:provision-runtime
```

The password is used only by this server-side command and must not be placed in `.dev.vars`, the
Worker bundle, source control, shell history, process arguments, or logs. The cache-disabled
Hyperdrive configuration must use a connection string for `brew_runtime`, not the migration owner.
After Cloudflare authentication, inspect the existing configuration with
`bun run --cwd webapp wrangler hyperdrive list` and `bun run --cwd webapp wrangler hyperdrive get <id>`;
create it through the authenticated Cloudflare dashboard or a short-lived local session that does
not print the connection string. Use `--caching-disabled` when creating or updating the
configuration. Put only the returned real ID into `wrangler.jsonc` as the `HYPERDRIVE` binding. Do
not commit a placeholder ID or a connection string.

After the real binding exists, run the temporary, read-only data-plane check with:

```bash
bun run db:smoke:hyperdrive
```

The command starts the smoke Worker with `wrangler dev --remote` on loopback, sends a one-time
token, verifies `SELECT 1`, the `brew_runtime` role, and an empty tenant read without
`app.network_id`, then terminates the development process. It does not deploy a permanent route or
create test data. It requires an authenticated Wrangler session and a real `HYPERDRIVE` binding.

The integration runner never touches a remote database. Point it at a local PostgreSQL admin URL;
it creates a random database, applies every migration, runs the RLS/constraint tests, and drops the
database in a `finally` block:

```bash
bun run test:integration:docker
```

Production release order is: apply migrations with the unpooled owner URL, smoke-test the database
and API, then deploy the Worker. Backups and disaster-recovery automation are out of scope for the
Demo MVP on Railway Hobby; the real Hyperdrive binding remains environment configuration rather
than a checked-in secret.
