# Brew Dashboard Differential Security Review — 2026-08-30

## Executive Summary

| Severity | Count |
| --- | ---: |
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 0 |

**Overall security risk:** LOW  
**Recommendation:** CONDITIONAL — security approval, production release only after the operational load gate below.

No exploitable security regression was found. The removed direct `auth.sessions` lookup is redundant
with the installed Better Auth 1.7.1 `get-session` implementation because cookie cache is disabled
and the library performs `findSession(sessionCookieToken)` against PostgreSQL on every protected
request. The new analytics SQL preserves the server-derived tenant boundary, explicit
`network_id` scoping, parameter binding, and PostgreSQL RLS.

The remaining concerns are release-assurance gaps rather than vulnerabilities: the new concurrent
integration test uses ten sessions for one account, and the 912-line analytics replacement has no
old-vs-new parity test across every period/filter combination.

**Key metrics:**

- Files analyzed: 11/11 changed or added files (100%).
- Repository strategy: FOCUSED (172 TypeScript/JavaScript source files; MEDIUM codebase).
- HIGH-risk surfaces fully reviewed: authentication middleware, tenant-scoped SQL, runtime role.
- Protected route blast radius: 10 middleware registrations expanding to 24 configured path entries.
- Security regressions detected: 0.
- Release/test assurance gaps: 2.

## What Changed

**Baseline:** `HEAD dd47cc0`  
**Review target:** current uncommitted working tree  
**Tracked diff:** +134 / -55 lines  
**Including new files:** +3,571 / -55 lines; 2,522 added lines are a generated Drizzle snapshot.

| File | Lines | Risk | Blast radius |
| --- | ---: | --- | --- |
| `backend/src/auth/http.ts` | +37 / -38 | HIGH | 24 protected paths; 5 profile callers |
| `backend/src/analytics/summary-service.ts` | +912 / -0 | MEDIUM | `/overview`, `/locations` |
| `backend/src/analytics/http.ts` | +3 / -6 | MEDIUM | 2 authenticated endpoints |
| `backend/drizzle/0013_disable-runtime-jit.sql` | +3 / -0 | MEDIUM availability | Every runtime connection |
| `backend/src/db/schema.ts` | +6 / -0 | LOW | Schema/index metadata |
| `scripts/release-load.mjs` | +13 / -3 | MEDIUM | Release gate |
| `backend/tests/integration/analytics.integration.test.ts` | +50 / -0 | LOW | Test-only |
| `backend/tests/integration/database.integration.test.ts` | +4 / -2 | LOW | Test-only |
| `backend/drizzle/meta/0013_snapshot.json` | +2,522 / -0 | LOW | Generated |
| `backend/drizzle/meta/_journal.json` | +8 / -1 | LOW | Migration ordering |
| `README.md` | +13 / -5 | LOW | Documentation |

## Security Findings

No CRITICAL, HIGH, MEDIUM, or LOW exploitable security findings were identified.

### Verified non-regression: database-backed session authorization remains authoritative

**Changed code:** `backend/src/auth/http.ts:393-423`  
**Historical source:** removed lookup introduced in `c21d75b`, not in a security/CVE fix.  
**Blast radius:** HIGH — every authenticated endpoint passes through `requireAuthentication`.  
**Confidence:** HIGH.

The removed code queried `auth.sessions` immediately after Better Auth resolved the same signed token.
In the current configuration:

1. `backend/src/auth/better-auth.ts:44-48` sets `cookieCache.enabled: false`.
2. Better Auth 1.7.1 executes `internalAdapter.findSession(sessionCookieToken)` before returning
   (`node_modules/better-auth/dist/api/routes/session.mjs:146-157`).
3. Missing/expired sessions return `null`; the middleware clears the cookie and returns 401.
4. `loadActiveProfile` still rejects disabled/expired accounts and sets server-derived RLS context.
5. Mutations retain the user advisory lock and profile row lock.

#### Adversarial scenarios checked

- **Forged cookie:** signature or DB token lookup fails before profile loading.
- **Revoked/expired cookie:** next `get-session` returns no active session; integration tests cover
  expiry, logout, reset, and disabled-account revocation.
- **Cross-user payload mismatch:** not public-reachable because Better Auth obtains the user through
  the session relation and `auth.sessions.user_id` has a foreign key to `auth.users.id`.
- **Concurrent revocation:** an already-started GET can finish during logout in both versions; the
  removed second SELECT did not create an atomic revocation boundary.

Defense-in-depth note: `isSessionPayload` does not explicitly assert
`payload.session.userId === payload.user.id`. This is not externally exploitable with the current
adapter and foreign key, but a local assertion would make the trust assumption explicit.

### Verified non-regression: tenant isolation in analytics SQL

**Changed code:** `backend/src/analytics/summary-service.ts:205-422` and `:436-534`  
**Blast radius:** LOW by direct caller count, HIGH data sensitivity.  
**Confidence:** HIGH.

The attacker model was an authenticated tenant-A user supplying a tenant-B location UUID, malformed
location value, maximum allowed period, and alternate sort parameters. The attempt does not cross
the tenant boundary because:

- `networkId` comes from the verified server-side profile, never from the request.
- `selected_location` requires both the supplied id and authenticated `network_id`.
- locations, orders, products, inventory, targets, and network rows carry tenant predicates/joins.
- every interpolated value is inside Drizzle's `sql` tag and becomes a bind parameter.
- RLS stays enabled and the runtime role remains non-owner and `NOBYPASSRLS`.
- integration coverage verifies foreign-tenant location fallback without data disclosure.

No SQL injection, cross-tenant read, privilege escalation, or new write path was found.

### Verified non-regression: runtime role privileges are unchanged

**Changed code:** `backend/drizzle/0013_disable-runtime-jit.sql:3`  
**Blast radius:** all new runtime sessions; operationally broad, security impact low.  
**Confidence:** HIGH.

`ALTER ROLE brew_runtime SET jit = off` changes a planner setting only. It grants no LOGIN,
ownership, table access, membership, superuser, `CREATEROLE`, or `BYPASSRLS`. The integration test
continues checking non-privileged attributes and now verifies `rolconfig` contains `jit=off`.

## Release-Assurance Gaps

### A1 — The local concurrency test is not a ten-user Cloudflare test

**Evidence:** `backend/tests/integration/analytics.integration.test.ts:204-252`  
**Impact:** production availability confidence, not a security bypass.

The test creates ten cookies for one account and invokes Hono in-process against direct local
PostgreSQL connections. It validates 20 concurrent authenticated requests and catches query
timeouts, but it does not exercise:

- ten distinct tenants/datasets;
- Cloudflare Free-plan per-request CPU accounting;
- production Hyperdrive pooling and existing upstream sessions;
- production Railway latency and connection limits.

The release script documents distinct demo accounts but cannot prove cookie ownership. Treat the
local result as a regression test, not proof that ten real users fit the Free plan.

### A2 — The new analytics implementation lacks full semantic parity coverage

**Evidence:** `backend/src/analytics/summary-service.ts` replaces established Overview and Locations
builders with 912 lines of SQL and response assembly.  
**Impact:** incorrect financial/dashboard values could pass response-schema validation.

Coverage checks schema validity, selected KPI equality, foreign/malformed location fallback, one
inventory-alert transition, and concurrent success. It does not compare old and new outputs for all
`today`, `7d`, `30d`, and `6m` periods; selected-location products/trends/goals; sorting modes;
zero baselines; or DST boundaries. This is not an identified exploit, but it is the largest residual
correctness risk.

## Test Coverage Analysis

Statement/branch coverage was not instrumented; this assessment is behavior-based.

| Changed surface | Coverage | Assessment |
| --- | --- | --- |
| `requireAuthentication` / `loadActiveProfile` | Expiry, logout, reset, disabled/expired accounts, success | Good indirect |
| `buildOverviewSummary` | Schema, selected KPIs, fallback, alert transition, concurrency | Partial |
| `buildLocationsSummary` | Schema, location count, concurrency | Partial |
| `jit=off` migration | Role config plus runtime integration workload | Good for new local sessions |
| `release-load.mjs` | Syntax/full script suite; no focused configuration unit test | Partial |

Validation evidence for this working tree:

- Integration: 37/37 tests, 563 assertions.
- Unit/component/script suites: 130/130 tests.
- TypeScript, Drizzle check, changed-file formatting, diff check, and production build passed.
- Gitleaks: 37 commits / approximately 3.09 MB scanned; no leaks found.
- Repository-wide `lint` passes ESLint, then fails on pre-existing unformatted
  `backend/drizzle/meta/0012_snapshot.json`; changed files pass Prettier.

## Blast Radius Analysis

| Function/change | Callers or affected paths | Classification | Priority |
| --- | ---: | --- | --- |
| `requireAuthentication` | 10 registrations / 24 configured paths | HIGH | P1 |
| `loadActiveProfile` | 5 direct callers | LOW by count, auth-sensitive | P1 |
| `buildOverviewSummary` | 1 direct caller | LOW | P2 |
| `buildLocationsSummary` | 1 direct caller | LOW | P2 |
| `ALTER ROLE ... jit=off` | Every new runtime DB session | Operationally CRITICAL | P1 rollout |

Protected request flow remains:

`route -> requireAuthentication -> Better Auth DB lookup -> active profile ->`
`transaction-local app.network_id -> endpoint SQL -> PostgreSQL RLS`.

## Historical Context

- `c21d75b` introduced the session re-read in initial Stage 3 auth; history does not mark it as a
  CVE/security remediation.
- `c453452` split profile/user queries so `FOR UPDATE` applies only to `app_users`; current code keeps
  that split on write paths and restores one-query join only for reads.
- `ad495c2` introduced the original in-Worker analytics builders. They remain exported but no longer
  serve Overview or Locations.
- `922fcd6` added both order-item indexes in migration `0012`; current schema source aligns with that
  applied migration and does not create duplicates.
- No removed check originated in a commit labeled security, fix, CVE, or vulnerability.

## Recommendations

### Immediate (Blocking)

- None from the security review.

### Before Production

- [ ] Apply migration `0013` before Worker deployment.
- [ ] Through a new real Hyperdrive connection, verify `current_user = 'brew_runtime'` and
  `SHOW jit` returns `off`; role defaults apply to new sessions.
- [ ] Run `test:load:release` with ten distinct demo-account cookies.
- [ ] Observe Cloudflare CPU time and `Worker exceeded CPU time limit`; wall time alone does not
  prove Free-plan CPU compliance.
- [ ] Add old-vs-new analytics parity coverage for every period, valid/foreign location, sorting,
  zero revenue, goals, products, alerts, and a DST boundary.

### Defense in Depth / Technical Debt

- [ ] Consider asserting `payload.session.userId === payload.user.id` after Better Auth parsing.
- [ ] Remove/mark unused legacy `buildOverview` and `buildLocations` after parity is established.
- [ ] Add focused release-load tests for too few and empty cookie arrays.

## Analysis Methodology

**Strategy:** FOCUSED for a medium repository, deep on every HIGH-risk change.

Techniques:

- all changed/new files reviewed;
- auth diff compared with HEAD and originating commits;
- pickaxe history and blame run on removed session validation;
- callers, protected routes, and runtime-role impact mapped;
- installed Better Auth 1.7.1 session implementation inspected;
- middleware-to-SQL-to-RLS trust boundaries traced;
- SQL interpolation and tenant predicates checked;
- test coverage analyzed and Gitleaks executed;
- independent adversarial modeling for forged/revoked cookies, cross-tenant ids, injection, and DoS.

Limitations:

- no production Cloudflare/Hyperdrive/Railway load test;
- no statement/branch coverage instrumentation;
- generated snapshot structurally reviewed, not audited line by line;
- dependency internals limited to installed locked Better Auth;
- performance evidence is local wall time, not Cloudflare CPU time.

**Confidence:** HIGH for authentication and tenant isolation; MEDIUM for production availability and
full financial-output parity.

## Final Decision

The diff is **APPROVED from a security-regression perspective**. Production rollout remains
**CONDITIONAL** on applying migration `0013`, validating `jit=off` through real Hyperdrive, and
passing the ten-distinct-account load gate while observing Cloudflare CPU metrics.
