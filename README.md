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
in the ignored `.dev.vars` file. Supabase keys are reserved for the server-side Worker and are not
available to Vite code or client bundles.

The repository intentionally contains only the active `webapp`, `backend` and
`packages/contracts` workspaces. Product screens, Supabase persistence, authentication and domain
contracts are introduced by later stages in `TASKS.md`.
