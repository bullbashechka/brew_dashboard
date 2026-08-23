# Brew Dashboard

Bun monorepo for the Brew Dashboard MVP. The active application surfaces are:

- `webapp/` — React, TypeScript, Vite and Playwright client;
- `backend/` — Hono API and its current server-side foundation;
- `packages/contracts/` — shared Zod schemas and TypeScript API contracts.

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
committing a connection string. The actual `HYPERDRIVE` binding ID is added to `wrangler.jsonc`
in S2.1, only after the Cloudflare configuration exists.

The repository intentionally contains only the active `webapp`, `backend` and
`packages/contracts` workspaces. Product screens and API flows are introduced by later stages in
`TASKS.md`; Stage 2 now contains the server-only Railway/Drizzle persistence foundation, while the
Worker binding remains intentionally unbound until the real Cloudflare configuration exists.

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
DATABASE_TEST_ADMIN_URL='postgresql://localhost/postgres' bun run test:integration
```

Production release order is: take/verify the Railway backup, apply migrations with the unpooled
owner URL, smoke-test the database and API, then deploy the Worker. Railway daily/weekly backup
schedules and the real Hyperdrive binding remain environment configuration rather than checked-in
secrets.
