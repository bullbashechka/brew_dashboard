# Stack-Specific Probes

The architectural vocabulary in [`knowledge-base.md`](knowledge-base.md) and the lenses in
[`dimensions.md`](dimensions.md) are technology-agnostic. This file adds the probes that only
make sense once you know the stack. In Phase 1 the orchestrator detects the stack(s); in
Phase 2 it pastes the matching probes for each lens into that reviewer's brief.

These are *architectural* concerns, not style. Formatting, naming, and idiom remain out of
scope. Skip any probe that doesn't apply; a system can span multiple stacks (paste from each).

---

## Frontend (web / mobile UI)

- **Design-system & theming architecture** _(Modularity, Extensibility)_ — Is there a single
  design-system/theming seam, or do components reach past it to raw primitives (raw CSS,
  vendor UI lib) so the design system can't be evolved or re-themed? How is multi-brand /
  multi-theme variation expressed — config/tokens (additive) or scattered conditionals
  (shotgun surgery)?
- **UI/UX consistency** _(Simplicity, Maintainability)_ — Is the same interaction (forms,
  loading, error, empty states) built one consistent way, or many? Inconsistency is a
  maintainability and product-quality cost, not a cosmetic one.
- **Component-API consistency** _(Modularity, Extensibility)_ — Do components share coherent
  prop/composition conventions, or does each invent its own contract? Are components deep
  (small props, real behaviour) or shallow pass-throughs?
- **Over-abstraction / template sprawl** _(Simplicity, Extensibility)_ — Generic
  page-template / multi-tenant machinery weighed by its testability and change cost; flag
  generic code that's hard to test in isolation or change safely.
- **Client performance shape** _(Performance)_ — Bundle weight and code-splitting, eager vs
  lazy loading of heavy deps/SDKs, render/data-fetching patterns (N+1 queries in lists),
  cache/invalidation story. Run the project's bundle/size report where one exists.
- **State & data ownership** _(Modularity)_ — Where does state live (server cache vs client
  store vs context vs storage), and is that boundary clear or smeared?

## Backend service / API

- **Request lifecycle & boundary validation** _(Security, Simplicity)_ — Where untrusted
  input is validated; authN/authZ choke points vs per-handler drift.
- **Data access & transaction boundaries** _(Performance, Modularity)_ — N+1 across the DB
  boundary, connection pooling, where transaction/consistency boundaries sit, data ownership
  per service.
- **Resilience** _(Performance, Deployability)_ — Timeouts, retries+backoff, circuit
  breakers, bulkheads, idempotency for at-least-once delivery, graceful degradation.
- **Contract & schema versioning** _(Extensibility, Deployability)_ — Backward/forward
  compatibility of APIs and event schemas; do producers and consumers deploy in lockstep?
- **Observability** _(Performance, Deployability)_ — Can latency/throughput/errors be seen on
  the paths that matter? Structured logs, traces, metrics.

## Data / ML pipeline

- **Lineage & idempotency** _(Maintainability, Performance)_ — Re-runnability, deterministic
  steps, backfill story; pipeline as pipes-and-filters vs tangled DAG.
- **Schema/contract evolution** _(Extensibility)_ — How upstream schema changes propagate;
  contract enforcement between stages.
- **State & storage** _(Modularity, Performance)_ — Partitioning/sharding, polyglot
  persistence fit, batch vs stream boundaries.
- **Reproducibility** _(Maintainability)_ — For ML: data/feature/model versioning, training
  vs serving skew.

## Infra / IaC

- **Module boundaries & reuse** _(Modularity, Maintainability)_ — Are infra modules cohesive
  and parameterised, or copy-paste per environment?
- **Blast radius & state** _(Security, Deployability)_ — State-file/segmentation,
  least-privilege of provisioning credentials, what a bad apply can take down.
- **Environment parity** _(Deployability)_ — Drift between environments; promotion path.

## Library / SDK

- **Public surface vs internals** _(Modularity, Extensibility)_ — Is the exported API small
  and deep, or does it leak internals consumers will couple to?
- **Backward compatibility** _(Extensibility)_ — Versioning policy; how breaking changes are
  managed for downstream consumers.
