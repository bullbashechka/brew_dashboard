# Architectural Knowledge Base

Technology-agnostic vocabulary for staff-engineer-level architectural assessment.
Each entry is a named concept + one-line definition. This is a vocabulary, not a tutorial —
link out rather than expand.

## Table of contents

1. [Architectural styles](#1-architectural-styles)
2. [Domain & boundaries](#2-domain--boundaries)
3. [Distributed systems & data](#3-distributed-systems--data)
4. [Messaging & integration](#4-messaging--integration)
5. [Resilience & failure](#5-resilience--failure)
6. [Scalability & performance](#6-scalability--performance)
7. [Security architecture](#7-security-architecture)
8. [Modularity & design principles](#8-modularity--design-principles)
9. [Evolution & change](#9-evolution--change)
10. [Quality attributes & trade-offs](#10-quality-attributes--trade-offs)
11. [Documentation & decisions](#11-documentation--decisions)
12. [Lens → domains mapping](#lens--domains-mapping)

---

## 1. Architectural styles

**Monolith** — single deployable unit; all modules share a process and address space.  
**Modular monolith** — monolith with strong internal module boundaries; single deployment, separable concerns.  
**Microservices** — independently deployable services, each owning its data; trades operational overhead for independent scalability and deployability.  
**Event-driven** — components communicate via events rather than direct calls; decouples producers from consumers at the cost of harder traceability.  
**Serverless / FaaS** — execution units provisioned per invocation; stateless by default; strong cold-start and vendor-coupling trade-offs.  
**Layered** — horizontal tiers (presentation → application → domain → infrastructure); common but can produce tight cross-layer coupling if not disciplined.  
**Hexagonal / ports-and-adapters** — domain at the centre; all external concerns (persistence, messaging, HTTP) attach via explicit ports; makes the domain independently testable.  
**Clean architecture** — concentric circles; dependency rule: outer layers depend inward, never the reverse.  
**Pipes-and-filters** — data passes through a chain of independent transformation steps; good for ETL and stream processing.  
**CQRS** — separates the write model (commands) from the read model (queries); enables independent scaling and optimisation of each side; pairs naturally with event sourcing.

---

## 2. Domain & boundaries

**Bounded context** (DDD) — an explicit boundary within which a model applies; the same term can mean different things across contexts.  
**Aggregate** (DDD) — a cluster of domain objects treated as a single consistency unit; defines the transaction boundary.  
**Ubiquitous language** (DDD) — shared vocabulary between engineers and domain experts, enforced in code.  
**Context mapping** (DDD) — explicit relationships between bounded contexts (shared kernel, customer/supplier, conformist, anti-corruption layer, open-host service, published language).  
**Anti-corruption layer** — a translation layer that insulates your domain model from an external model you don't control; prevents a third-party schema from bleeding into your core.  
**Strangler fig** — incrementally replace a legacy system by routing traffic to new components; old system atrophies as surface area is claimed.

---

## 3. Distributed systems & data

**CAP theorem** — a distributed store can guarantee at most two of: consistency, availability, partition tolerance. In practice, partition tolerance is not optional, so the real choice is consistency vs. availability under a partition.  
**PACELC** — extends CAP: even without partitions, there is a latency vs. consistency trade-off.  
**Strong consistency** — all reads see the latest write; typically requires coordination (quorum, leader election).  
**Eventual consistency** — replicas converge over time; lower latency and higher availability, but callers must tolerate stale reads.  
**Two-phase commit (2PC)** — distributed transaction protocol; atomic across nodes but blocks on coordinator failure.  
**Saga** — long-running distributed transaction as a sequence of local transactions with compensating actions on failure; avoids 2PC locks.  
**Outbox pattern** — writes events to a local outbox table in the same transaction as the domain change; a relay publishes them; guarantees at-least-once delivery without dual-write risk.  
**Event sourcing** — state is derived by replaying an immutable log of events; audit trail and temporal queries for free; replay complexity is the cost.  
**Idempotency** — an operation that can be applied multiple times with the same effect as once; essential for at-least-once delivery.  
**Partitioning / sharding** — distributing data across nodes by key; increases write throughput; complicates cross-shard queries and transactions.  
**Read replica** — a copy of a data store that serves reads; scales read throughput; introduces replication lag.  
**Database-per-service** — each service owns its data store; decouples schema evolution; makes cross-service joins expensive.  
**Polyglot persistence** — different services or components use different storage technologies suited to their access patterns.

---

## 4. Messaging & integration

**Synchronous (request/response)** — caller blocks waiting for a reply; simple but creates temporal coupling.  
**Asynchronous (event / message)** — caller fires and forgets; decouples lifecycle but makes failure and ordering harder to reason about.  
**Pub/sub** — publishers emit to a topic; multiple independent subscribers consume; decouples producers from consumer count.  
**Queue** — point-to-point delivery; each message consumed once; useful for work distribution and backpressure.  
**Choreography** — each service reacts to events and decides its own next action; no central orchestrator; harder to trace end-to-end flow.  
**Orchestration** — a central coordinator directs participating services; easier to trace, creates a coupling point.  
**Backpressure** — a mechanism for a consumer to signal a producer to slow down; prevents unbounded buffer growth.  
**Dead-letter queue** — destination for messages that cannot be processed after retries; enables inspection and replay without data loss.  
**Contract / schema versioning** — explicit backward/forward-compatible contracts between producer and consumer; prevents breaking changes from propagating silently.

---

## 5. Resilience & failure

**Timeout** — upper bound on how long a call is allowed to take; prevents indefinite blocking.  
**Retry with backoff + jitter** — re-attempt after increasing delays with randomisation; avoids thundering herd.  
**Circuit breaker** — trips open after N failures; stops calls to a failing dependency; resets after a probe succeeds; protects the caller from cascading failure.  
**Bulkhead** — isolates resource pools (thread pools, connection pools) so one failing dependency cannot exhaust resources for others.  
**Rate limiting** — caps request rate per client or globally; protects capacity and provides fairness.  
**Graceful degradation** — serves a reduced but functional experience when a dependency is unavailable.  
**Fallback** — alternative behaviour when the primary path fails (cached response, default value, static content).  
**Blast-radius containment** — architectural boundary that limits the scope of a failure; a single service misbehaving should not take down unrelated services.  
**Redundancy / failover** — duplicate components that take over on primary failure; active-active vs. active-passive trade-offs.

---

## 6. Scalability & performance

**Horizontal scaling** — add more instances of a component; requires stateless design or externalised state.  
**Vertical scaling** — increase resources of a single instance; simpler but has a ceiling and a single point of failure.  
**Statelessness** — no per-request local state; any instance can serve any request; prerequisite for horizontal scaling.  
**Caching** — store computed or fetched results for reuse; key design decisions are cache level (in-process, shared, edge), invalidation strategy, and consistency.  
**Cache invalidation** — the mechanism for expiring stale cache entries; the hardest part of caching.  
**Connection pooling** — reuse established connections rather than creating one per request; critical for database and downstream service callers.  
**Async offload** — defer non-critical work (emails, thumbnails, analytics) to background workers; improves request latency.  
**Denormalisation** — redundant data stored for read performance; trades write complexity and consistency for read speed.

---

## 7. Security architecture

**Zero-trust** — no implicit trust based on network location; every request authenticated and authorised explicitly.  
**Defense-in-depth** — multiple independent security layers; a single bypass does not compromise the system.  
**Least privilege** — components and users have only the permissions they need; minimises blast radius of a compromise.  
**Trust boundaries** — explicit lines across which data must be validated and credentials checked; often align with service boundaries, network segments, or user roles.  
**Token-based / federated identity** — authentication delegated to an identity provider; services verify tokens rather than managing passwords; enables SSO and cross-service propagation.  
**Secret management** — credentials, keys, and certificates stored in a dedicated secrets service; never in source code or environment variables baked into images.  
**Encryption in transit** — all communication between components encrypted; mutual TLS adds authentication.  
**Encryption at rest** — persisted data encrypted; key management is the hard part.  
**Threat modelling** — systematic analysis of potential attack vectors (actors, assets, boundaries, threats, mitigations); STRIDE is a common framework.  
**Confused deputy** — a trusted component is tricked into acting on behalf of an attacker; common in SSRF, CSRF, and cross-tenant access bugs.

---

## 8. Modularity & design principles

**SOLID** — five OO principles: Single responsibility, Open/closed, Liskov substitution, Interface segregation, Dependency inversion. At the architectural level these translate to: one reason to change per module, extend via new code not edits, substitutable implementations, narrow interfaces, dependencies pointing toward stability.  
**Deep modules** — small public interface, large private implementation; maximises information hiding per unit of interface surface. See [`../../tdd/deep-modules.md`](../../tdd/deep-modules.md).  
**Information hiding** — implementation details not visible outside the module; change the internals without affecting callers.  
**Coupling** — degree to which one module depends on another; afferent (incoming) vs. efferent (outgoing); minimise efferent coupling to unstable modules.  
**Cohesion** — how closely related the responsibilities within a module are; aim for high cohesion (one clear purpose).  
**Dependency inversion** — high-level modules do not depend on low-level modules; both depend on abstractions; stable abstractions are depended upon; concrete implementations depend on them, not vice versa.  
**Separation of concerns** — different concerns (business logic, persistence, transport, auth) handled by distinct components.  
**Law of Demeter** — a module should only talk to its immediate collaborators, not traverse object graphs; reduces coupling.  
**DRY at the decision level** — every design decision should have a single authoritative location; duplication of knowledge (not code) is the real problem.

---

## 9. Evolution & change

**Evolutionary architecture** — fitness functions (automated checks) guard architectural properties across changes; architecture intentionally designed to change over time.  
**Fitness function** — an automated assertion over an architectural property (e.g. no module may depend on the persistence layer directly); fails the build if violated.  
**Strangler fig** — see [§2 Domain & boundaries](#2-domain--boundaries).  
**Branch by abstraction** — introduce an abstraction over a component you want to replace; migrate callers to the abstraction; swap the implementation.  
**Backward compatibility** — new versions remain usable by consumers of old versions; essential for APIs and event schemas that cross team or service boundaries.  
**Versioning strategy** — explicit policy for how interfaces evolve: additive only, version-in-URL, content negotiation, consumer-driven contracts.

---

## 10. Quality attributes & trade-offs

Staff engineers name trade-offs, not just problems. Every quality attribute competes with others.

| Attribute | What it buys | Common tensions |
|---|---|---|
| Reliability | Stays up under failure | ↑ cost, ↑ complexity |
| Scalability | Handles growth in load | ↑ operational overhead, ↓ simplicity |
| Security | Resists attack | ↑ friction, ↓ performance |
| Maintainability | Easy to change | ↑ abstraction overhead upfront |
| Testability | Confidence in changes | ↑ interface discipline |
| Observability | Understand runtime behaviour | ↑ instrumentation cost |
| Cost efficiency | Runs cheap | Competes with reliability and performance |

The job is not to maximise all of these simultaneously. It is to identify which are most important for this system *right now*, name the ones being traded away, and flag where the current balance seems wrong.

---

## 11. Documentation & decisions

**C4 model** — four levels of context diagrams: Context (system in its environment), Container (deployable units), Component (modules inside a container), Code. Useful for sharing a system map without prose.  
**Architecture Decision Records (ADRs)** — lightweight documents capturing *why* a significant design choice was made, the context, alternatives considered, and consequences. For creating ADRs in this repo, see the [`record-decision`](../../../record-decision/SKILL.md) skill.

---

## Lens → domains mapping

Use this table when constructing reviewer briefs in Phase 2. Paste only the listed domain sections — not the full knowledge base — into each reviewer's `{{KNOWLEDGE BASE}}` slot.

| Lens | Relevant knowledge-base domains |
|---|---|
| Simplicity & understandability | §1 Architectural styles · §8 Modularity & design principles · §10 Quality attributes |
| Maintainability | §8 Modularity & design principles · §9 Evolution & change · §10 Quality attributes · §11 Documentation |
| Extensibility | §1 Architectural styles · §2 Domain & boundaries · §8 Modularity & design principles · §9 Evolution & change |
| Security | §7 Security architecture · §4 Messaging & integration (contract versioning) · §10 Quality attributes |
| Performance & scalability | §6 Scalability & performance · §5 Resilience & failure · §3 Distributed systems & data · §4 Messaging & integration |
| Modularity | §8 Modularity & design principles · §1 Architectural styles · §2 Domain & boundaries · §3 Distributed systems (data ownership) |
| Deployability | §1 Architectural styles · §5 Resilience & failure · §9 Evolution & change · §4 Messaging & integration (contract versioning) |
