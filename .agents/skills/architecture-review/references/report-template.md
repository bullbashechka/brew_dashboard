# Report Template

Written to `./docs/architecture-reviews/<descriptive-name>.md`. Narrative and
evidence-grounded — no numeric scores, no severity tags. Triage lives in the
recommendations section, expressed as ranking and prose.

```markdown
# Architecture Review — [project / system name]

_Read-only assessment. Date: [YYYY-MM-DD]. Scope: [what was and wasn't covered]._

## Verdict

One blunt paragraph: what overall architectural health is this system in? This is allowed
to be net-negative ("structurally unsound in its current form because…") and must not be
softened for balance. State the single most important thing the reader should take away.

## Executive summary

The 2–3 biggest architectural risks, in plain language. What they are, why they matter.
Note genuine strengths *only* where they exist and are material — so deliberate design is
distinguishable from accident. Do not manufacture positives to balance the risks.

## System map

- **Entry points** — what drives the system.
- **Modules / services** — each with its responsibility in one line.
- **Boundaries & data flow** — how a representative request or job moves through.
- **State & persistence** — what's stored and who owns it.
- **External dependencies** — owned services vs. third parties.
- **Runtime shape** — monolith / services / serverless.

## Findings by dimension

One subsection per lens. Short overall verdict (blunt, may be net-negative; note strengths
only where genuine), then findings ranked most-serious first. Each finding: **what**,
**where** (file-path / measured evidence), **why it matters** architecturally, **direction**
for remediation. If a dimension is genuinely healthy, say so plainly — but only if the
evidence supports it.

### Simplicity & understandability
### Maintainability
### Extensibility
### Security
### Performance & scalability
### Modularity (deep modules + coupling & cohesion)
### Deployability

## Cross-cutting themes

Where several lenses independently landed on the same subsystem or boundary — name the
convergence. These themes usually drive the top of the roadmap.

## Prioritised recommendations

Ranked — most architectural impact first. For each:
- **What to change** and the outcome it buys.
- **Why it's ranked here** — cost of leaving it.
- **Next step** — concrete direction; the skill does not apply fixes.
```
