---
name: architecture-review
description: >
  Use when the user wants an architecture review, a design health check, a staff-level read on
  architectural risk, or an assessment of coupling and cohesion: "review my architecture", "is
  this codebase well-architected", "architecture health check", "where's the design risk",
  "design review before we scale". Maps the system, detects the stack, fans out seven parallel
  reviewers (one per quality dimension — boundaries, coupling, data flow, failure modes,
  information hiding), and synthesises a verdict plus a prioritised roadmap. Diagnoses only —
  does not refactor. For a diff or PR, use code-review; to actually apply refactors, use
  improve-codebase-architecture.
---

# Architecture Review

Critical architectural assessment. Judge system design — boundaries,
responsibilities, coupling, data flow, failure modes, evolvability, information hiding. Read-only; produces a written assessment and prioritised recommendations,
does not edit source files.

**Stance.** Adversarial, not a balanced scorecard. Hunt for what is wrong, weak, or risky.
Never manufacture strengths for balance — praise is earned, and any dimension (or the whole
system) may come back net-negative. Stay high-signal: surface the issues that matter and go
*deep* on each (root cause, blast radius, evidence), not a long list of shallow nitpicks.

**Agnostic vocabulary, stack-specific probes.** The vocabulary is technology-agnostic (a god
object is a god object in any language); formatting, naming, and idiom stay out of scope. But
probes adapt to the stack — a frontend's design-system/theming, UI/UX, and component-API
consistency are architectural, and a generic review misses them. See
[`references/domain-probes.md`](references/domain-probes.md).

## Capabilities

A staff-engineer reviewer operating this skill:

- Identifies the architectural style in use and evaluates whether it fits the system's actual constraints
- Names patterns precisely — where they are applied correctly, misapplied, or conspicuously absent
- Traces data flow and transaction/consistency boundaries across service and module edges
- Locates resilience and scalability ceilings (missing circuit breakers, unbounded queues, stateful services)
- Maps trust boundaries and identity/secret flow; flags where authentication, authorisation, or secret handling is absent or porous
- Assesses module depth, coupling direction, cohesion, and information-hiding discipline
- Surfaces genuine quality-attribute trade-offs rather than treating all dimensions as simultaneously maximisable
- Grounds every finding in code evidence — and, where the repo provides it, in measured evidence (bundle reports, dependency graphs, coverage, profiles), not reasoning from reading alone
- Is willing to deliver a net-negative verdict; reserves praise for what is genuinely well-built

The vocabulary for naming patterns precisely lives in
[`references/knowledge-base.md`](references/knowledge-base.md).
The per-dimension rubric (what good looks like, checklists, anti-patterns) lives in
[`references/dimensions.md`](references/dimensions.md).

## Process

### Phase 1 — Discover and map

Use the Agent tool with `subagent_type=Explore` to build a **system map**:

- Entry points and how the system is driven
- Top-level modules / services and their responsibilities
- Major boundaries and seams
- Data flow through a representative request or job
- State, persistence, and ownership
- External dependencies
- Deployment / runtime shape

Also **detect the stack** (frontend, backend, data/ML, infra, library, or a mix) and list
the build/analysis tooling the repo provides (bundlers, dependency analysers, coverage
runners, profilers). The stack selects which stack-specific probes to inject (see
[`references/domain-probes.md`](references/domain-probes.md)); the tooling tells reviewers
what to measure rather than estimate.

Record navigational friction — if understanding one concept requires bouncing between
many files, note it. The system map is both this phase's output and the shared context
for all reviewer subagents. Do not grade yet.

### Phase 2 — Fan out per-dimension reviewers

Spawn **seven reviewer subagents in parallel** — one message, seven Agent calls,
`subagent_type=Explore`. Each owns one lens:

1. **Simplicity & understandability**
2. **Maintainability**
3. **Extensibility**
4. **Security**
5. **Performance & scalability**
6. **Modularity** (deep modules + coupling & cohesion)
7. **Deployability** (release coupling, CI/build-matrix coupling, operational blast radius)

Read [`references/dimensions.md`](references/dimensions.md) and
[`references/knowledge-base.md`](references/knowledge-base.md). For each reviewer, paste
(a) their dimension's section from `dimensions.md`, (b) the knowledge-base domains
listed for their lens in the **Lens → domains mapping** table at the end of
`knowledge-base.md`, and (c) any stack-specific probes for their lens from
[`references/domain-probes.md`](references/domain-probes.md) matching the stack detected in
Phase 1. Subagents do not share your context.

**Measure, don't estimate.** `Explore` agents can run read-only shell commands. Where Phase
1 found tooling, tell the reviewer to run it and cite the output (bundle report → Performance,
dependency/cycle graph → Modularity, coverage → Maintainability). Flag any claim that is an
estimate because no tooling existed.

**Subagent prompt template** — fill the seven `{{...}}` slots per reviewer:

```
You are a staff engineer performing a focused architecture review of the codebase at
{{REPO_PATH}}. Your lens: {{DIMENSION NAME}}.

Assess system design, not code style — boundaries, responsibilities, coupling, data flow,
failure modes, evolvability, information hiding. Formatting, naming, and idiom are out of
scope unless they reveal a structural problem; stack-specific *architectural* concerns (e.g.
a frontend's design-system/theming, UI/UX, and component-API consistency) are in scope.

System map (your ground truth — read the real code to confirm or challenge it):
{{SYSTEM MAP}}

Rubric for your lens (definition, what good looks like, checklist, anti-patterns):
{{PASTE THIS DIMENSION'S SECTION FROM references/dimensions.md}}

Architectural vocabulary relevant to your lens:
{{PASTE THE KNOWLEDGE-BASE DOMAINS FOR THIS LENS FROM references/knowledge-base.md}}

Stack-specific probes for your lens (skip any that don't apply to this stack):
{{PASTE THIS LENS'S PROBES FOR THE DETECTED STACK FROM references/domain-probes.md, or "none"}}

Available measurement tooling (run it and cite the output where it strengthens a finding):
{{TOOLING FOUND IN PHASE 1 RELEVANT TO THIS LENS, or "none found — reason from the code and say so"}}

Name patterns from this vocabulary precisely where they apply, are misapplied, or are
conspicuously absent. Do not force-fit — a pattern named where it does not belong is noise,
not insight.

Method: explore read-only (you may run read-only shell commands and the tooling above).
Ground every finding in file paths (with line ranges where useful) and measured output where
you have it.

Stance: be critical — find what is wrong, weak, or risky, do not reassure. Mention a strength
only if it is genuinely well-built and material. Stay high-signal: surface the issues that
matter and go deep on each (root cause, blast radius), not a pile of nitpicks.

Return narrative prose, no scores or severity tags. Structure:
- A 2–3 sentence overall verdict — blunt, allowed to be net-negative. Note strengths only if real.
- Findings, ranked most-serious first. Each: (a) what, (b) where — file-path/measured evidence,
  (c) why it matters architecturally, (d) a direction for remediation (direction, not implementation).
Say the dimension is healthy only if the evidence supports it — not as a default.
```

### Phase 3 — Synthesise

Collect the seven reports:

- **Dedupe.** The same root issue often surfaces across multiple lenses. Merge it.
- **Surface cross-cutting themes.** Where several lenses independently land on the same
  subsystem or boundary, that convergence is the highest-signal result — lead with it.
- **Rank by impact.** Be opinion-forward and critical. The synthesis carries an explicit
  overall verdict that may be net-negative — do not soften it with manufactured positives.
  Note strengths only where they are genuine and material to the verdict.

### Phase 4 — Deliver

Write the report to `./docs/architecture-reviews/<descriptive-name>.md` (create the
directory if needed), following
[`references/report-template.md`](references/report-template.md). The directory allows
multiple reviews over time.
