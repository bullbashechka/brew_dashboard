# Architecture Review: Technical Debt Baseline

**Date:** 2026-08-27  
**Scope:** Entire Bun monorepo and current working tree  
**Decision horizon:** Complete MVP release gates, then reduce near-term change risk  
**Evidence:** `PRD.md`, `TASKS.md`, production code, tests, build/audit/coverage/E2E output

## Executive verdict

The modular serverless monolith is the right system shape for the stated MVP. The architecture should be evolved, not replaced. The largest risk is not missing infrastructure: it is an unreliable release gate combined with several coordinator modules whose behavior is insufficiently characterized. Immediate value comes from restoring trustworthy tests and tightening existing module boundaries. Database/query redesign belongs behind measurement gates.

## Dimension assessment

| Dimension | Assessment | Evidence and decision |
|---|---|---|
| Boundaries | Needs targeted work | Shared contracts (`packages/contracts/src/index.ts:1-846`), backend analytics (`backend/src/analytics/service.ts:415-1273`) and AppShell (`webapp/src/components/app-shell.tsx:51-518`) have high fan-in/mixed ownership. Split by existing domains; do not add layers globally. |
| Coupling/cohesion | Medium risk | String query-key prefixes (`webapp/src/api/analytics.ts:38-129`) and root route casts (`backend/src/index.ts:524-615`) couple producers/consumers implicitly. Typed factories and domain registration reduce this locally. |
| Data flow | Medium/high risk | Snapshot loading (`backend/src/analytics/service.ts:415-608`) plus repeated scans (`:279-380`) define the scaling ceiling, but are acceptable until MVP-limit measurements fail. |
| Resilience | High test risk | E2E guard (`webapp/e2e/fixtures.ts:8-34`) cannot distinguish expected mocked failures and currently watches only its default page, not additional system-test contexts. |
| Security | Sound with two follow-ups | Request transaction/RLS boundary is explicit (`backend/src/auth/http.ts:348-412`). Resolve or accept the moderate dev-tool advisory; measure transaction hold time without weakening RLS. |
| Operability | Partial | Stage 12 remains open (`TASKS.md:436-447`); real DB/system validation needs a reproducible local admin URL/runtime and green canonical gate. |
| Changeability | Medium risk | Mutation-heavy coordinators (`inventory-page.tsx:37-236`, `products-page.tsx:41-140`, `settings-page.tsx:41-135`) raise test blast radius; owner-local characterization-first extractions are sufficient. |
| Performance | Unproven ceiling | PRD budgets (`PRD.md:802-825`) exist; mocked performance checks are currently red with the suite. Query and transaction work must be driven by production-like measurements. |
| Evolvability | Good for MVP | A single Worker/Postgres deployment is intentionally simple. No evidence justifies microservices, queues, CQRS or a second state layer. |
| Testability | Uneven | Domain calculations/contracts are strong; HTTP/service/page orchestration is weak in the fast suites and real DB tests are environment-bound. |

## C4-lite context

```text
Browser (React/TanStack)
        |
        | shared Zod HTTP contracts
        v
Cloudflare Worker (Hono/OpenAPI)
        |
        | authenticated request transaction + transaction-local tenant context
        v
Hyperdrive (cache disabled) -> PostgreSQL / RLS
```

The shape is coherent. Current debt accumulates at the Browser→API cache boundary, the Hono route→handler typing boundary, and inside the analytics Request→Snapshot→Response path.

## Highest-value changes

1. Make mocked and real-system gates trustworthy before refactoring.
2. Characterize coordinator behavior, especially error/retry/cache/tenant paths.
3. Centralize query keys and split coordinators along already visible responsibilities.
4. Keep Stage 1 analytics work structural; defer SQL aggregation, alert endpoints and transaction-lifetime changes until measurements prove value.

## Explicitly rejected directions

- Microservices or service extraction: deployment and ownership complexity with no current scale signal.
- Generic repository/service frameworks: would add indirection around a small set of concrete paths.
- Global state migration: TanStack Query plus URL state is adequate; the issue is key ownership, not library choice.
- Global coverage thresholds as the primary target: they reward cheap lines rather than high-risk behavior.
- Splitting schemas/migrations by file size: database invariants and RLS need centralized visibility.

## Evolution checkpoints

- **Checkpoint A:** tasks 001–002 green; mocked and real-system release signals are reliable.
- **Checkpoint B:** selected owner tasks 005–011 merged with characterization added inside each change and no API/DB schema behavior drift.
- **Checkpoint C:** collect production-like latency, query count/rows, Worker CPU/memory and transaction duration.
- **Checkpoint D:** separately approve only the Stage 2 task whose threshold failed.

Detailed execution tasks and acceptance criteria live in [`tech_debt/README.md`](../../tech_debt/README.md).
