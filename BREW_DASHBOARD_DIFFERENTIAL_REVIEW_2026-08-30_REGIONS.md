# Differential Review: expanded onboarding regions

## 1. Executive Summary

| Severity    | Count |
| ----------- | ----: |
| 🔴 CRITICAL |     0 |
| 🟠 HIGH     |     0 |
| 🟡 MEDIUM   |     0 |
| 🟢 LOW      |     1 |

**Overall Risk:** LOW  
**Recommendation:** CONDITIONAL — approve if the intended behavior is automatic currency/timezone defaults after manual ISO country-code entry. If the intended behavior is a visible country picker, the implementation is incomplete.

**Key Metrics:**

- Files analyzed: 3/3 changed files (100%) plus the one-hop contract, API, page, backend handler, and backend service path.
- Added country mappings exercised: 5/5.
- Security regressions detected: 0.
- Removed validation or access-control checks: 0.
- Changed production helper blast radius: 1 direct consumer and 1 UI event caller (LOW).

## 2. What Changed

**Diff range:** working tree against `HEAD`  
**Relevant history:** the suggestion and manual-override mechanism was introduced in commit `4f8d5a1` (`Harden onboarding and analytics flows`, 2026-08-25).  
**Review date:** 2026-08-30

| File                                         | Added | Removed | Risk                     | Blast radius       |
| -------------------------------------------- | ----: | ------: | ------------------------ | ------------------ |
| `webapp/src/components/first-run-forms.tsx`  |     5 |       0 | MEDIUM business behavior | LOW                |
| `webapp/tests/unit/first-run-forms.test.tsx` |    25 |       0 | LOW                      | Test-only          |
| `PRD.md`                                     |     6 |       3 | LOW                      | Documentation-only |

**Total:** +36/-3 lines across 3 files.

The production change appends these rows to the existing suggestion map:

| Country | Currency | Timezone            |
| ------- | -------- | ------------------- |
| `BE`    | `EUR`    | `Europe/Brussels`   |
| `DE`    | `EUR`    | `Europe/Berlin`     |
| `NL`    | `EUR`    | `Europe/Amsterdam`  |
| `DK`    | `DKK`    | `Europe/Copenhagen` |
| `ES`    | `EUR`    | `Europe/Madrid`     |

No registration, authentication, authorization, persistence, schema, or database code was changed.

## 3. Findings

### 🟢 LOW: The change does not add a visible region list

**File:** `webapp/src/components/first-run-forms.tsx:445`  
**Blast radius:** onboarding country input only  
**Test coverage:** YES for autofill behavior; NO for a picker because no picker exists

**Description:** The country control remains a two-character text input with `maxLength={2}`. The user must manually enter `BE`, `DE`, `NL`, `DK`, or `ES`. The added mapping then fills currency and timezone. Country names such as “Бельгия” or “Германия” do not appear as selectable options.

**Impact:** There is no runtime or security defect if the requirement was “support these ISO codes with defaults.” There is a product gap if “expand regions” meant “show these regions in the registration UI.”

**Recommendation:** Confirm the intended UX. If a visible list is required, add a localized country selector or datalist while continuing to submit ISO alpha-2 codes through the existing contract.

## 4. Correctness and Regression Analysis

The effective runtime path is:

1. The country input uppercases user input.
2. `applyCountrySuggestion` looks up the exact ISO code in `countrySuggestions`.
3. Currency/timezone are written only when empty or previously auto-suggested.
4. Fields marked as manually edited remain unchanged when the country changes.
5. `onboardingRequestSchema` validates the complete payload in the form.
6. The same schema parses the request again before the API call.
7. The backend parses the same shared schema before normalization, demo generation, and persistence.

The new diff changes only step 2 data. It does not modify steps 1 or 3–7. Therefore the protection added by commit `4f8d5a1` against overwriting manual currency/timezone values remains intact.

All six reviewed combinations (`BE`, `DE`, `NL`, `DK`, `ES`, and existing `US`) passed:

- ISO country validation;
- ISO currency validation through `Intl.supportedValuesOf("currency")`;
- IANA timezone construction through `Intl.DateTimeFormat`;
- the complete shared `onboardingRequestSchema`.

The selected timezone is intentionally a default, not a geographic guarantee for every territory. Users can override it, and the existing manual-override logic preserves that choice.

## 5. Test Coverage Analysis

**Changed mapping coverage:** 5/5 added entries (100%).

The added unit test verifies for every new code that:

- lowercase input is normalized to uppercase;
- the expected currency is inserted;
- the expected timezone is inserted.

Existing tests additionally verify that:

- manual currency values survive a country change;
- manual timezone values survive a country change;
- unknown countries clear only values that were auto-suggested;
- onboarding values survive a server error;
- the full form submits a schema-valid payload.

Validation results:

| Check                                             | Result                 |
| ------------------------------------------------- | ---------------------- |
| Webapp unit suite                                 | ✅ 51 passed, 0 failed |
| Shared contract probe for all reviewed regions    | ✅ 6 passed            |
| Webapp TypeScript                                 | ✅ Passed              |
| ESLint on changed TS/TSX files                    | ✅ Passed              |
| Production webapp build and artifact sanitization | ✅ Passed              |

**Coverage limitation:** There is no dedicated browser E2E that submits each newly added country through a live database. The backend path is shared and data-independent after common-schema validation, so this does not expose a likely region-specific failure, but it prevents claiming absolute production certainty.

## 6. Blast Radius Analysis

| Changed surface           |             Direct consumers | Risk | Priority |
| ------------------------- | ---------------------------: | ---- | -------- |
| `countrySuggestions` data | 1 (`applyCountrySuggestion`) | LOW  | P3       |
| `applyCountrySuggestion`  |   1 country-input `onChange` | LOW  | P3       |

No external calls, access-control decisions, tenant boundaries, value transfers, or persistence operations were added or weakened.

## 7. Historical Context

- Commit `4f8d5a1` introduced the country suggestion map and manual-override tracking as part of onboarding hardening.
- The reviewed diff only appends map entries; it removes no production code.
- Git history contains no evidence that these exact mappings were previously removed because of a bug or security issue.
- No security-related removal, validation regression, or reintroduced vulnerable pattern was found.

## 8. Recommendations

### Immediate

- [ ] Clarify whether manual ISO-code entry is acceptable or a visible localized country list is required.

### Before production

- [ ] If this onboarding path is business-critical, add one E2E case for a newly added region (for example `DE`) to verify persistence and generated profile output in a real browser/database journey.

### No action required

- The currency/timezone mapping itself does not need a corrective patch.
- Existing manual overrides, unknown-country handling, and shared validation should remain unchanged.

## 9. Analysis Methodology

**Strategy:** FOCUSED. The repository contains 162 TypeScript/TSX files (MEDIUM), while the reviewed production diff is one low-blast-radius UI data map.

**Techniques:**

- compared working-tree changes with `HEAD`;
- reviewed all changed files;
- inspected the introducing commit and blame history;
- traced one-hop callers and the full submit/validation/backend path;
- checked removed-code and security-regression risk;
- measured direct blast radius;
- reviewed changed and existing regression tests;
- ran unit, contract, type, lint, and production-build checks.

**Excluded from scope:** unrelated pre-existing uncommitted Drizzle migration files were not reviewed or modified.

**Confidence:** HIGH that the five codes trigger the configured defaults without regressing manual-value preservation; MEDIUM regarding the user's intended UI because the request may have meant a visible country selector.
