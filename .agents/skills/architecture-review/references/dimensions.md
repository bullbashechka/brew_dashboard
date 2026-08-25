# Review Dimensions

The seven lenses an architecture review fans out across. Each reviewer subagent owns one.
Every section has the same shape:

- **What it means** — the staff-engineer framing of the dimension.
- **What good looks like** — the characteristics of a healthy system on this axis.
- **Assessment checklist** — concrete probes to run against the code and the system map.
- **Architectural anti-patterns** — structural smells to watch for. These are
  deliberately *language-agnostic*: a god object is a god object in any language. Do not
  flag formatting, naming, or idiom unless it reveals one of these structural problems.

Keep every judgement at the level of *system design* — boundaries, responsibilities,
coupling, data flow, failure modes, evolvability, information hiding — not the cleanliness
of code in a particular language.

---

## 1. Simplicity & Understandability

**What it means.** How much a new engineer must hold in their head to safely change one
thing. Complexity that is essential to the problem is fine; complexity the architecture
*adds* — accidental complexity — is the target. The best systems make the important
things obvious and the dangerous things hard.

**What good looks like.**
- A reader can form a correct mental model of a subsystem from its boundary, without
  reading every internal file.
- Responsibilities are named and located where you'd expect them ("least surprise").
- Control flow and data flow are traceable; there's an obvious "main path".
- Important decisions are explicit and discoverable, not buried in implicit conventions.
- Complexity is concentrated behind interfaces, not smeared thinly across many files.

**Assessment checklist.**
- Pick a representative change. How many files/modules must you understand to make it
  safely? How many would a newcomer touch by mistake?
- Can you predict where a given responsibility lives before you look?
- Is there a single obvious entry point per flow, or several plausible ones?
- How much hidden/implicit behaviour (global state, conventions, side effects on import)
  must you know that isn't visible at the call site?
- Does understanding one concept require bouncing between many small files?
- **Pattern consistency:** is the same problem solved the same way throughout, or several
  inconsistent ways? Are conventions (error handling, data fetching, state, file layout)
  applied uniformly or ad hoc? Inconsistency forces a reader to re-learn each corner.

**Architectural anti-patterns.**
- **Accidental complexity** — structure that makes a simple change ripple widely.
- **Configurability sprawl** — endless flags/options where a sensible default belongs.
- **Implicit/temporal coupling** — call B must follow call A but nothing says so.
- **Mystery action at a distance** — behaviour driven by hidden global/shared state.
- **Premature generalisation / over-abstraction** — abstractions built for use cases that
  don't exist, adding layers the reader must traverse for no current benefit. Weight this by
  its *testability and change cost*: generic multi-tenant / template / heavily-parameterised
  code that is hard to test in isolation or hard to change safely is a ranked finding, not a
  footnote — the abstraction is costing more than it saves.
- **Pattern inconsistency** — the same concern implemented several different ways, so there
  is no single mental model to carry from one part of the system to the next.

---

## 2. Maintainability

**What it means.** The cost of changing the system after it ships — fixing bugs, adjusting
behaviour, keeping it healthy under a rotating team. Maintainability is mostly a function
of how *localised* change is: good architecture confines the blast radius of a change to
one place.

**What good looks like.**
- A typical change is local — one module, behind one interface.
- Tests exist at meaningful boundaries and survive internal refactors (they assert on
  observable behaviour, not implementation detail).
- Duplicated *knowledge* is rare — a single source of truth for each rule/concept.
- Dependencies and versions are managed; upgrades are routine, not feared.
- The "why" behind non-obvious decisions is recorded (ADRs, docs) where it's needed.

**Assessment checklist.**
- For a plausible change, trace the blast radius: how many modules must change in lockstep?
- Are there boundary tests, or only brittle internal unit tests that pin implementation?
- Is the same business rule encoded in several places that must change together?
- How risky is a dependency upgrade — is there a seam, or does it leak everywhere?
- Where would a six-months-later engineer get stuck for lack of recorded rationale?
- **Convention consistency:** is there one established way to do a recurring task, or do
  several coexist (competing data-fetching layers, two state patterns, parallel v1/v2
  implementations)? Each inconsistent variant is extra surface to learn and maintain.

**Architectural anti-patterns.**
- **Shotgun surgery** — one logical change forces edits across many modules.
- **Knowledge duplication** — the same rule re-implemented in multiple places (DRY at the
  level of *decisions*, not merely code lines).
- **Brittle test suites** that pin internals, so every refactor breaks tests and refactors
  stop happening.
- **Dependency leakage** — a third-party type/SDK threaded through the whole codebase with
  no boundary, so it can never be replaced or upgraded cleanly.
- **Undocumented load-bearing decisions** — critical "why"s that live only in someone's head.

---

## 3. Extensibility

**What it means.** How well the system absorbs the *next* requirement — the change you can
foresee in its category but not in detail. Good architecture is open to the likely axes of
change and closed against churn on the stable ones. The goal is not maximal flexibility
(that's its own smell) but flexibility aimed at where the system actually evolves.

**What good looks like.**
- Adding a new variant of an existing concept (a new payment method, a new report type)
  is an *additive* change behind a stable interface, not a rewrite of existing code.
- Extension points exist where variation is real, and nowhere it isn't.
- Stable, widely-depended-on contracts change rarely; volatile detail sits behind them.
- New features compose with existing ones rather than special-casing them.

**Assessment checklist.**
- Identify the system's likely axes of change. Are those the *cheap* changes to make?
- To add the next obvious variant, do you extend (add code) or modify (edit shared code)?
- Are interfaces defined in terms of stable domain concepts, or leaky implementation detail?
- Do the most depended-upon modules also change the most? (A bad sign — see Modularity.)
- Is there flexibility built for variation that never materialised (cost without benefit)?

**Architectural anti-patterns.**
- **Rigidity** — every new variant requires editing existing, shared code paths.
- **Switch-on-type sprawl** — adding a case means hunting down every `if type == …` site.
- **Leaky abstractions** — interfaces that expose implementation detail, so callers couple
  to *how* not *what*, and the implementation can't evolve.
- **Speculative generality** — extension points and plug-in machinery no requirement uses.
  Judge it by its carrying cost: machinery that is hard to test or that every change must
  route through is a net liability, not future-proofing — flag and rank it accordingly.
- **Stable-depends-on-volatile** — core modules depending on details that change often.

---

## 4. Security

**What it means.** Whether the *architecture* protects the system's assets — independent of
any single vulnerable line. Trust boundaries, where data is validated, how secrets and
identity flow, and what the blast radius is when one component is compromised. This is a
design review, not a line-by-line audit or a linter pass.

**What good looks like.**
- Trust boundaries are explicit; untrusted input is validated as it crosses them.
- AuthN/AuthZ are enforced at consistent choke points, not re-implemented ad hoc per handler.
- Least privilege between components; a compromised component can't reach everything.
- Secrets and credentials flow through a managed path, not scattered or hard-coded.
- Sensitive data has a clear lifecycle (where it's stored, logged, and for how long).
- Failure is safe-by-default (deny on error), and security-relevant events are observable.

**Assessment checklist.**
- Draw the trust boundaries. Where does untrusted data enter, and where is it validated —
  at the edge, or hopefully somewhere deeper?
- Is authorization centralised and consistent, or duplicated per endpoint with drift?
- If component X is compromised, what else does it reach? Is privilege segmented?
- How do secrets reach the code that needs them? Anything hard-coded or over-shared?
- Does sensitive data end up in logs, caches, or error payloads it shouldn't?
- On error, does the system fail closed or fail open?

**Architectural anti-patterns.**
- **Perimeter-only security** — hard shell, soft interior; once inside, anything goes.
- **Scattered/duplicated authz** — every handler re-checks permissions slightly differently.
- **Over-privileged components** — broad credentials/network reach with no segmentation.
- **Implicit trust between services** — internal callers assumed safe, inputs unvalidated.
- **Secrets in code/config/logs** — credentials living where they can leak.
- **Confused-deputy / missing boundary validation** — a component acts on unvalidated
  input on behalf of a less-privileged caller.

---

## 5. Performance & Scalability

**What it means.** Whether the *shape* of the system can meet its load and growth — set by
architecture (data access patterns, coupling of work, where state lives, sync vs async)
far more than by micro-optimisations. Review the structural ceilings, not nanoseconds.

**What good looks like.**
- Work scales with demand in a predictable way; the obvious growth (10× users/data) has a
  known, affordable answer.
- Expensive resources (DB connections, network round-trips) are used deliberately, not
  per-item in a loop across a boundary.
- State that needs to scale is partitionable; the design isn't pinned to one shared bottleneck.
- Slow or bursty work is decoupled (async/queues) from latency-sensitive paths where apt.
- Caching, when present, has a clear invalidation story and ownership.
- There's a way to *see* performance — key paths are measurable.

**Assessment checklist.**
- For the main flows, how does work grow with input/users/data — linear, or worse?
- Are there N+1 patterns or chatty cross-boundary calls (per-item queries/RPCs in a loop)?
- What's the central bottleneck (a single DB, a shared lock, a hot service)? Can it partition?
- Is heavy or bursty work synchronous on a user-facing path that should be async?
- Where's the caching, and who owns invalidation? Any unbounded growth (memory, queues)?
- Can the team observe latency/throughput on the paths that matter?

**Architectural anti-patterns.**
- **N+1 / chatty coupling** — per-item calls across an expensive boundary in a loop.
- **Single shared bottleneck** — all load funnels through one unpartitionable resource.
- **Synchronous coupling of slow work** — user requests block on work that could be deferred.
- **Unbounded growth** — caches/queues/in-memory state with no eviction or backpressure.
- **Premature optimisation** — structural complexity added for performance no measurement
  justified (the inverse smell — note it too).
- **No observability** — performance can't be measured, so it can't be reasoned about.

---

## 6. Modularity (deep modules + coupling & cohesion)

**What it means.** Whether the system is built from the right *units* with the right
*seams*. This lens reuses two ideas the rest of the repo already leans on: **deep modules**
and **coupling & cohesion**.

A **deep module** has a small interface hiding a large implementation — it gives you a lot
of capability for a little interface surface. A **shallow module** is the opposite: its
interface is nearly as complex as what it does, so it adds cost without hiding much. See
[`deep-modules.md`](../../tdd/deep-modules.md) for the canonical definition and diagram —
don't restate it, apply it.

**What good looks like.**
- Modules are **deep**: small, stable interfaces over substantial, hidden implementation.
- **High cohesion** — each module does one well-defined job; its parts belong together.
- **Low coupling** — modules interact through narrow, explicit interfaces, not shared
  internals or sprawling parameter lists.
- **Dependencies point in a stable direction** — volatile, detail-heavy code depends on
  stable abstractions, not the reverse; no dependency cycles between modules.
- **Information hiding** — design decisions (formats, algorithms, storage choices) are
  encapsulated, so they can change without rippling outward.

**Assessment checklist.**
- For the key modules: is the interface small relative to the implementation (deep), or
  is it nearly as complex (shallow pass-through)?
- **Cohesion:** does each module have one reason to exist, or is it a grab-bag (a `utils`
  or `manager` that accreted unrelated things)?
- **Coupling:** how do modules talk — narrow interfaces, or reaching into each other's
  internals / shared mutable state / huge parameter objects?
- **Afferent vs efferent:** which modules are depended on by many (afferent)? Are *those*
  the stable ones? Which depend on many others (efferent) — are they the volatile leaves?
- Are there dependency **cycles** between modules or layers?
- Does the boundary hide the decision, or leak it (callers depending on internal detail)?

**Architectural anti-patterns.**
- **Shallow modules** — interfaces nearly as complex as their implementation; thin
  pass-throughs that add a hop without hiding anything.
- **God object / god module** — one unit that knows and does too much; everything depends on it.
- **Grab-bag modules** — `utils`, `helpers`, `manager`, `common` with no cohesive purpose.
- **Feature envy / inappropriate intimacy** — a module reaching into another's internals
  rather than going through its interface.
- **Dependency cycles** — mutually-depending modules that can't be understood, tested, or
  deployed independently.
- **Unstable dependency direction** — stable, core modules depending on volatile details
  (should be inverted).
- **Distributed monolith** — physically separated services so tightly coupled they must be
  changed and deployed together; the cost of distribution without the independence.

---

## 7. Deployability

**What it means.** Whether the system can be *released and operated* safely and
independently — distinct from whether the code is well-structured. A clean module graph can
still ship as one indivisible, high-risk release. This lens looks at the units of deployment,
how coupled their releases are, and the blast radius when one goes wrong.

**What good looks like.**
- Deploy units can be released independently; one team/app/service shipping does not force a
  lockstep release of others.
- The build/release pipeline scales sub-linearly with the number of units — adding the Nth
  app/service doesn't multiply CI cost or coordination.
- Rollout is incremental and reversible: feature flags, canaries, a real rollback path.
- A failed or bad deploy of one unit is contained; it doesn't cascade to unrelated units.
- Release-time configuration and secrets flow through a managed, environment-specific path.

**Assessment checklist.**
- What are the actual units of deployment, and can each ship on its own? Or does a change to
  one shared package/contract force everything to rebuild and redeploy together?
- Is the CI/build matrix coupled — does one config (brand/region/service) per-axis multiply,
  and does a change touch every cell? How long is the critical path to production?
- What is the operational blast radius of a bad deploy — one unit, or the whole estate?
- Is there a rollback/canary/flagging story, or is every release all-or-nothing?
- Do shared contracts (schemas, generated types, shared libs) version independently, or must
  producers and consumers deploy in lockstep?

**Architectural anti-patterns.**
- **Release lockstep / distributed monolith** — separately-deployed units that must be built
  and shipped together because they share pinned versions or tightly-coupled contracts.
- **CI-matrix explosion** — per-brand/region/service build cells that multiply, so cost and
  coordination grow with every axis and a one-line change rebuilds the world.
- **All-or-nothing release** — no canary, flagging, or rollback; every deploy bets the estate.
- **Unbounded operational blast radius** — one unit's bad deploy cascades to unrelated units.
- **Deploy-time config sprawl** — release configuration/secrets scattered across the pipeline
  with no single managed source per environment.
