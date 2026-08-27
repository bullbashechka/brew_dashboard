# Repository Guidelines

This file applies to the whole repository unless a deeper `AGENTS.md` overrides it.

## Operating Standard

- Answer in the user's language.
- Read the relevant conversation and repository context before acting.
- The user alone decides when repository files may be changed. Unless the user gives explicit permission to begin changes in the current conversation, work read-only: inspect, analyze, review, plan, and report without editing, generating, formatting, or deleting files.
- A request to inspect a diff, review an implementation, analyze a stage, identify edge cases, or propose solutions does not authorize changes. Wait for a separate explicit instruction from the user before implementing any proposed fix.
- After explicit permission is given, be autonomous within the authorized scope: implement, validate, and report without unnecessary confirmation loops.
- Ask only when ambiguity blocks a safe decision, a material product or architecture choice is open, or an action is destructive, irreversible, security-sensitive, or likely to affect unrelated users or data.
- Verify uncertain claims through repository evidence, documentation, tests, scripts, runtime output, or logs. Do not invent facts.
- Preserve unrelated user changes. Do not revert, overwrite, reformat, or clean up work outside the requested scope.
- Keep the process proportional to the task and leave the system clearer, more correct, and easier to verify.

## Sources of Truth

This repository is in the specification phase. `PRD.md` is the source of truth for product intent and architecture; `TASKS.md` defines implementation stages and acceptance criteria.

Once implementation exists, current code, schemas, tests, and runtime output describe actual behavior. Treat conflicts with `PRD.md` or `TASKS.md` as specification drift: call them out and align them when the task permits rather than silently choosing one side.

## Project Structure & Module Organization

The target Bun workspace is a monorepo with:

- `webapp/` — React, TypeScript, Vite, TanStack, Tailwind, shadcn/ui, and Recharts.
- `backend/` — Hono API deployed with the web app on Cloudflare Workers; server-only Drizzle schema and database access live here.
- `packages/contracts/` — shared Zod schemas and request/response types.
- `backend/drizzle/` — generated versioned PostgreSQL migrations; never edit an applied migration.

Place static assets under `webapp/public/`. Keep unit and component tests near their modules and Playwright journeys in a dedicated E2E directory.

## Repository Grounding & Task Approach

- Start from the repository rather than assumptions. For non-trivial work, read the relevant parts of `README.md`, `PRD.md`, `TASKS.md`, and nearby code.
- Discover the current structure with `rg --files` or `tree` when the relevant files are unclear. Do not use documentation as a hand-maintained file inventory.
- Use the repository's existing package manager, scripts, test runner, formatter, linter, build tools, and generators.
- Dependencies already selected by `PRD.md` or `TASKS.md` may be added as part of an authorized scaffolding or implementation task. Obtain approval before adding an unplanned production dependency.
- Classify work proportionally:
  - `Direct` — cosmetic or obvious local edits with no meaningful behavior change; inspect nearby usage, make the smallest coherent change, and run narrow validation when relevant.
  - `Investigation` — diagnosis where the failure path is unclear; reproduce or trace the primary symptom before patching and reassess the approach if repeated attempts do not improve the signal.
  - `Behavioral` — logic, contracts, auth, permissions, persistence, validation, routing, state transitions, concurrency, or non-trivial user-facing behavior; define observable acceptance criteria and prefer a failing test first when the repository supports it and the risk justifies it.
- For non-trivial work, derive a short acceptance contract from `PRD.md`, `TASKS.md`, or the user's request: what “done” means, 3–5 observable pass/fail criteria, the primary user-visible or runtime signal, and relevant secondary checks.

## Research & Root-Cause Discipline

- Trace the owning execution path before fixing non-trivial behavior: UI/caller → routing/orchestration → handler/service → shared contract/API → persistence or external system.
- Inspect directly coupled surfaces: sibling flows, producer and consumer sides of contracts, read and write paths, serializers, migrations, tests, and documentation.
- Check relevant loading, empty, error, success, disabled, optimistic, retry, and stale-data states without turning a focused task into an unrelated audit.
- Fix the owner layer rather than masking an upstream error in a child component or helper. Avoid duplicated decision logic and defensive state repair that preserves the underlying inconsistency.
- If re-architecture or migration is required, state the scope, risks, compatibility constraints, and rollout order before expanding the change.

## Minimal Sufficient Change

- Make the smallest coherent change that fully solves the problem at the owning layer. Minimal means minimal surface area, moving parts, and abstraction count—not the fewest changed lines at any cost.
- Prefer clear, flat implementations over speculative helpers, hooks, services, wrappers, folders, or framework-like abstractions.
- Prefer local clarity and decoupling over premature DRY. Add an abstraction only when it removes current, demonstrated complexity.
- Keep diffs focused and avoid unrelated formatting churn.

## Build, Test, and Development Commands

The repository exposes these commands from the root:

- `bun install` — install workspace dependencies.
- `bun run dev` — start the web app and Worker locally.
- `bun run lint` — check source style and common errors.
- `bun run typecheck` — validate all TypeScript workspaces.
- `bun run test` — run unit and component tests.
- `bun run test:integration` — test APIs against isolated local PostgreSQL fixtures.
- `bun run test:e2e` — run Playwright user journeys.
- `bun run build` — produce the Worker and static application bundle.

Only document and run commands that are defined in the root `package.json`, except for initial scaffolding and repository inspection commands.

## Coding Style, Contracts & Documentation

- Use TypeScript with two-space indentation and shared Zod contracts instead of duplicated interfaces.
- Use `PascalCase` for components and types, `camelCase` for functions and variables, and `kebab-case` for route files. Database identifiers use `snake_case`.
- When a shared contract or schema changes, inspect and validate both producer and consumer sides.
- Do not manually edit generated files unless the repository explicitly requires it. Change the source and run the generator.
- Update durable documentation when a change materially affects architecture, setup, operations, contracts, user flows, migrations, or non-obvious decisions. Avoid documentation churn for trivial refactors.
- If relevant documentation remains stale but is outside scope, report the drift explicitly.

## Testing & Validation

- Name unit and component tests `*.test.ts(x)` and Playwright tests `*.spec.ts`.
- Cover financial calculations, timezone boundaries, validation, tenant isolation, authentication, ledger reversals, and responsive critical paths. Add negative cases for permission, tenant, contract, and validation boundaries.
- Integration tests use isolated local PostgreSQL fixtures and never Railway production data.
- Run the smallest meaningful validation covering the changed surface. Prefer targeted tests, then typecheck, lint, build, and wider suites as risk requires.
- Treat non-zero exits, runtime errors, unhandled rejections, failed assertions, type errors, lint errors, build failures, and timeouts as failed validation.
- Do not declare success from proxy metrics alone. A green lint, typecheck, or unit suite does not prove the task complete if the primary user-visible or runtime signal remains broken.
- If only secondary checks were run, report the result as partially validated. If validation cannot run, explain why and identify the best substitute signal.
- Never hide validation failures. Report what failed, what it means, and the next useful experiment.

## UI & Design

- Follow the existing design system, component primitives, spacing scale, and visual language unless the user explicitly requests a redesign.
- Prefer layout rules owned by parent containers and semantic component props over ad hoc consumer overrides or one-off values.
- Treat shared visual components as coherent units and introduce a reusable variant only when a real repeated need exists.
- Validate affected responsive states and critical accessibility behavior. Include desktop and mobile screenshots in pull requests for UI changes.

## Security, Data & Workspace Hygiene

- Never commit credentials or local environment files, or expose secrets, tokens, private keys, cookies, customer data, or raw `.env` values in responses, logs, fixtures, tests, documentation, or screenshots.
- Keep Railway connection strings out of Worker variables: production Worker database access uses a cache-disabled Hyperdrive binding. Keep `BETTER_AUTH_SECRET` server-side in Cloudflare Secrets and never include database/auth secrets in the Vite client bundle.
- Derive tenant scope from the verified session. Never trust or accept client-supplied `network_id`; verify that related UUIDs belong to the same tenant.
- Do not weaken authentication, authorization, validation, encryption, rate limits, tenant isolation, or auditability to make a task easier.
- Use Drizzle schema source and generated versioned PostgreSQL migrations. Never edit an applied migration; add a new migration and validate affected read paths, write paths, constraints, functions, RLS policies, and Drizzle-inferred database types.
- Keep temporary investigation artifacts under `./.scratch/` or a tool-owned artifact directory rather than the repository root.
- Do not stop unrelated processes to free ports; use isolated ports or local configuration overrides.
- Do not stage, commit, amend, rebase, reset, stash, push, delete files, or add hosted automation unless explicitly requested.

## Commit & Pull Request Guidelines

History is minimal; use a short imperative subject such as `Add sales analytics contracts`. Keep commits focused. Pull requests should summarize scope, reference a `TASKS.md` stage or issue, list exact verification commands, and include desktop/mobile screenshots for UI changes. Call out migrations, secrets, contract changes, rollout implications, and known gaps.

## Completion Protocol

For non-trivial implementation or investigation, report concisely:

- what changed and why, including the root cause when identified;
- affected layers and the primary signal status: met, not met, or partially validated;
- exact secondary checks run and their results;
- documentation, migration, compatibility, or rollout implications when applicable;
- remaining risks, missing coverage, or the best next experiment.

Do not create this ceremony for simple local edits. A task is not complete when the visible symptom is gone but the same mechanism remains inconsistent across directly coupled layers.
