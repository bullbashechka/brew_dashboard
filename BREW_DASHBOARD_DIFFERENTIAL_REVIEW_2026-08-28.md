# Differential Security Review — Brew Dashboard

**Дата:** 2026-08-28  
**Язык отчёта:** русский  
**Baseline:** `c453452` (`Harden release readiness and expired data cleanup`)  
**Диапазон:** незакоммиченный working tree относительно `HEAD` (`git diff HEAD` + 2 новых файла)  
**Стратегия:** SURGICAL для LARGE-репозитория (202 файла), 100% изменённых файлов

## 1. Executive Summary

| Severity | Count |
| --- | ---: |
| 🔴 CRITICAL | 0 |
| 🟠 HIGH | 1 |
| 🟡 MEDIUM | 2 |
| 🟢 LOW | 0 |

**Overall Risk:** HIGH  
**Recommendation:** REJECT до исправления HIGH finding и повторного system E2E

**Ключевые метрики:**

- Проанализировано файлов: 9/9 (100%)
- Изменение: +149 / -37 строк
- HIGH-risk пути без достоверного system-подтверждения: 2 (`/api/v1/events`, `/api/v1/feedback`)
- Изменённые security controls: 1 (`assertSystemE2eLogSafety`)
- Прямых удалений production auth/tenant/validation checks: 0
- Полный system/performance E2E не запущен: Docker daemon недоступен

Главный вывод: новый system-тест заявляет проверку tenant scope и feedback/log safety через реальный Worker, но общая Playwright-fixture перехватывает primary-page requests к обоим соответствующим endpoint. Forged-scope запрос выполняется на отдельно созданной `secondaryPage` и достигает Worker, тогда как feedback canaries на primary page до Worker и его логов не доходят.

## 2. What Changed

**Commit Range:** `c453452..working-tree`  
**Commits:** 0 (локальные незакоммиченные изменения)  
**Timeline:** baseline 2026-08-28 → working tree 2026-08-28

```text
c453452  Harden release readiness and expired data cleanup
   │
   └── working tree: split system/performance gates, tenant attacks,
       log canaries and persisted-log scanner
```

| File | +Lines | -Lines | Risk | Blast Radius |
| --- | ---: | ---: | --- | --- |
| `README.md` | 7 | 3 | LOW | Documentation |
| `backend/scripts/run-system-e2e.ts` | 23 | 8 | HIGH | Все system/performance запуски |
| `package.json` | 5 | 3 | MEDIUM | Stage 12 release gate |
| `scripts/system-e2e-fixture.ts` | 13 | 0 | MEDIUM | 3 импортера |
| `scripts/system-e2e-log-safety.ts` | 11 | 0 | HIGH | 1 runtime caller, 1 test caller |
| `scripts/system-e2e-log-safety.test.ts` | 17 | 0 | MEDIUM | Новый security-control test |
| `webapp/e2e/performance.spec.ts` | 5 | 15 | MEDIUM | 2 проекта × 3 повтора |
| `webapp/e2e/system.spec.ts` | 61 | 8 | HIGH | 2 browser projects |
| `webapp/playwright.config.ts` | 7 | 0 | MEDIUM | 9 E2E spec-файлов |

Статистика таблицы отражает исходный diff до remediation; итоговый рабочий tree дополнительно меняет `webapp/e2e/fixtures.ts` и добавляет изменения scanner/test.

## 3. Findings

### 🟠 HIGH: System journey частично мокает endpoints, которые должен проверять через Worker

**Files:** `webapp/e2e/system.spec.ts:L82`, `webapp/e2e/system.spec.ts:L179`, `webapp/e2e/fixtures.ts:L102`  
**Baseline commit:** `c453452`  
**Blast Radius:** 2 security-sensitive endpoints, 2 browser projects; весь заявленный feedback/event фрагмент system journey  
**Test Coverage:** присутствует, но не достигает проверяемой server boundary

**Описание**

Автоматическая fixture, используемая `system.spec.ts`, без условия регистрирует на основной `page`:

```ts
await page.route("**/api/v1/events", (route) => route.fulfill({ status: 202, ... }));
await page.route("**/api/v1/feedback", (route) => route.fulfill({ status: 200, ... }));
```

Поэтому:

1. Запрос `POST /api/v1/events` с поддельным `networkId` на `system.spec.ts:L179` выполняется через отдельно созданную `secondaryPage`, поэтому он достигает Zod/server tenant boundary. Но primary-page telemetry остаётся mocked, и fixture в целом не гарантирует real endpoint coverage для system journey.
2. `GET/PUT /api/v1/feedback` на primary page выполняются против mock. Проверка сохранения feedback после Reset не подтверждает БД или tenant scope.
3. Новые `desiredFeatures` и `feedbackComment` canaries не попадают в Worker, поэтому log-safety scan не способен обнаружить regression в реальном feedback handler.

**Historical Context**

- Безусловные mocks добавлены в `c453452` как baseline для обычных mocked journeys.
- Исходная версия diff расширяла тот же spec до real-Worker security journey, но не отключала baseline mocks в `E2E_SYSTEM=1`; remediation ниже устраняет это.
- Удалённого security check здесь нет; это нарушение trust boundary между browser test и реальным Worker.

**Attack / Regression Scenario**

**Attacker model:** разработчик или dependency regression, которые случайно/намеренно добавляют логирование feedback либо ослабляют event validation.

1. В feedback handler появляется `console.log(requestBody)` или event schema начинает принимать client-supplied tenant scope.
2. Stage 12 system journey запускается с canary text и forged `networkId`.
3. Playwright перехватывает primary-page requests до Worker; отдельный forged request secondary page остаётся реальным.
4. Реальная feedback-ветка не исполняется; feedback canaries отсутствуют в Worker logs.
5. Release gate может стать зелёным, хотя production logs раскрывают пользовательский текст, а feedback persistence/tenant boundary не подтверждены real-Worker тестом.

**Exploitability:** MEDIUM — требуется code regression/внутренний доступ, но gate, предназначенный ловить именно этот класс регрессий, его не видит.  
**Impact:** production feedback может попасть в application logs; event tenant boundary остаётся без real-Worker E2E подтверждения.

**Recommendation**

- Не регистрировать общие `/events` и `/feedback` mocks в `E2E_SYSTEM=1`, либо явно `unroute` их перед security/system steps.
- Проверять feedback persistence повторным реальным `GET /api/v1/feedback` после Reset.
- После исправления подтвердить, что forged event request реально возвращает `400` от Worker и что canary values отсутствуют в captured Worker logs.

### 🟡 MEDIUM: Failure path повторно раскрывает найденное чувствительное значение и сохраняет исходный лог

**Files:** `scripts/system-e2e-log-safety.ts:L6`, `scripts/system-e2e-log-safety.ts:L9`, `backend/scripts/run-system-e2e.ts:L45`, `backend/scripts/run-system-e2e.ts:L63`  
**Blast Radius:** все system/performance executions через один runner  
**Test Coverage:** unit test закрепляет включение canary в exception message; cleanup/redaction test отсутствует

**Описание**

`assertSystemE2eLogSafety` складывает сами совпавшие значения в `findings`, затем включает их в exception. Runner печатает `error.message` через `console.error`. Если совпадением является `systemSecret`, login или form canary, checker повторно выводит точное значение в более широкий Playwright/CI output.

Одновременно `.scratch/system-e2e-server.{stdout,stderr}.log` только обнуляются перед следующим запуском и не удаляются после scan. При срабатывании проверки исходный unsafe output остаётся на диске в ignored, но долговечном файле.

**Attack / Failure Scenario**

1. Worker regression выводит `BETTER_AUTH_SECRET` или пользовательский canary.
2. Scanner корректно находит совпадение.
3. Exception содержит само секретное значение.
4. Runner выводит exception в CI console, расширяя аудиторию и retention поверхности.
5. Исходный файл остаётся в `.scratch/` после завершения.

**Exploitability:** HARD — нужен logging regression или доступ к test runner.  
**Impact:** раскрытие ephemeral auth secret/test identifiers и сохранение form text в локальном/CI workspace; failure path нарушает собственную цель redaction.

**Recommendation**

- Возвращать только категории и количество совпадений (`secret canary`, `form canary`, `credential marker`), никогда не сами значения.
- Удалять либо безопасно очищать оба capture-файла в `finally` после анализа; при необходимости диагностики сохранять только redacted summary.
- Изменить unit test так, чтобы он проверял отказ без присутствия canary в тексте ошибки.

### 🟡 MEDIUM: Scanner одновременно пропускает raw credentials и отвергает безопасный route name

**Files:** `scripts/system-e2e-log-safety.ts:L1`, `backend/scripts/run-system-e2e.ts:L57`, `scripts/system-e2e-fixture.ts:L8`  
**Coupled production evidence:** `backend/src/http/middleware.ts:L101`  
**Blast Radius:** один общий scanner для всех system/performance Worker logs  
**Test Coverage:** 3 assertions; нет raw-password/DB-URL/route-pattern cases

**Описание**

False negative:

- Runner передаёт exact canaries, `systemSecret` и logins, но не fixture passwords и не `isolated.runtimeUrl`/runtime credential.
- Regex ловит слово `password`, но пропустит значение пароля или PostgreSQL URL, выведенное без такого label.

False positive:

- Regex считает любое отдельное слово `feedback` unsafe.
- Безопасная observability запись содержит matched route (`route: "/api/v1/feedback"`) согласно `observabilityMiddleware`.
- Как только feedback mock из Finding 1 будет отключён, легитимный route pattern сам по себе способен уронить log-safety gate, даже если request body не логируется.

**Attack / Regression Scenario**

1. Tooling печатает raw connection string или fixture password без имени поля.
2. Ни exact-canary list, ни field-name regex не совпадают.
3. Gate проходит при credential exposure.

Обратная сторона: реальный безопасный запрос feedback создаёт route-only лог и может быть ошибочно классифицирован как утечка, что подталкивает оставлять endpoint mocked.

**Exploitability:** MEDIUM для false negative; EASY для false positive после включения real endpoint.  
**Impact:** неполное подтверждение критерия «credentials отсутствуют в logs» и недостоверный release signal.

**Recommendation**

- Передавать scanner exact fixture passwords и exact runtime credential/URL (без включения значений в diagnostics).
- Разбирать structured log records и проверять запрещённые keys/values, а не искать слова по всему сериализованному тексту.
- Разрешить безопасные поля `route`, включая `/api/v1/feedback`, при одновременном запрете `comment`, `desiredFeatures`, request bodies, headers и exact canaries.
- Добавить negative tests: raw password, raw DB URL, secret canary не отражается в error; safe feedback route проходит.

## 4. Test Coverage Analysis

| Surface | Existing/changed test | Assessment |
| --- | --- | --- |
| `assertSystemE2eLogSafety` | 1 unit test, 3 assertions | PARTIAL: happy reject cases only; redaction, cleanup, raw credentials и safe route не покрыты |
| Forged tenant read/write | `system.spec.ts` | PARTIAL: overview/product paths real; event path intercepted |
| Feedback persistence/reset | `system.spec.ts` | NO real-Worker coverage: endpoint intercepted |
| Performance split | Playwright discovery | 2 projects обнаружены; runtime budgets не проверены |
| Stage 12 command wiring | package scripts | Static review only; Docker gate unavailable |

**Доступная validation:**

- ✅ `bun run lint`
- ✅ `bun run typecheck`
- ✅ `bun run test` — 117 passed, 0 failed
- ✅ `bun test scripts/system-e2e-log-safety.test.ts` — 1 passed
- ✅ `git diff --check`
- ✅ Playwright discovery: 2 `@system` tests и 2 `@performance` tests
- ❌ `docker info` — daemon unavailable; `test:e2e:system:docker` и `test:e2e:performance:docker` не запускались

Secondary checks зелёные, но primary signal для изменённой system boundary **не подтверждён**. После remediation forged event assertion на `secondaryPage` должен получить Worker `400`; это ещё не проверено runtime из-за отсутствия Docker.

## 5. Blast Radius Analysis

| Changed surface | Direct consumers/executions | Risk | Priority |
| --- | ---: | --- | --- |
| Common Playwright auto-fixture | 9 spec-файлов | HIGH для system mode | P0 |
| `@system` journey | 2 browser projects | HIGH | P0 |
| `@performance` journey | 2 projects × 3 repeats | MEDIUM | P1 |
| `assertSystemE2eLogSafety` | 1 runtime caller + 1 unit caller | HIGH control, LOW call count | P1 |
| `run-system-e2e.ts` | system + performance root gates | HIGH | P1 |
| `validate:stage12` | весь release readiness chain | HIGH aggregate | P0 |

```text
validate:stage12
  ├─ test:e2e:system:docker ─┐
  └─ test:e2e:performance:docker
                             └─ Playwright webServer
                                  └─ run-system-e2e.ts
                                       ├─ isolated PostgreSQL
                                       ├─ local Worker
                                       └─ log-safety scan

system.spec.ts
  └─ common fixtures.ts
       ├─ /events mock ──────X────> real Worker
       └─ /feedback mock ────X────> real Worker
```

## 6. Historical Context

- `8f25259` ввёл system runner и базовые Stage 12 E2E fixtures.
- `c453452` добавил durable stdout/stderr files и безусловные common `/events`/`feedback` mocks.
- Текущий working tree добавляет log canaries, scanner, forged tenant requests и разделяет system/performance gates.
- `git blame` не выявил удаление строк из commits с `security`, `CVE` или security-fix контекстом.
- Удалённый onboarding из `performance.spec.ts` перенесён в runner для `-p` accounts; production validation не ослаблялась.

## 7. Recommendations

### Immediate (Blocking)

- [ ] Убрать system-mode interception `/api/v1/events` и `/api/v1/feedback` на primary page (или заменить fixture на context-aware режим без этих mocks).
- [ ] Исправить log checker: redacted diagnostics, exact credential canaries, structured allow/deny rules.
- [ ] Не сохранять raw unsafe capture после scan.
- [ ] Запустить оба Docker gates и подтвердить реальный `400` для forged scope, feedback persistence и отсутствие canaries в Worker logs.

### Before Production

- [ ] Прогнать полный `bun run validate:stage12` с доступным Docker daemon.
- [ ] Проверить log-safety test на synthetic raw password, PostgreSQL URL, cookie/header, form text и безопасный feedback route.
- [ ] Зафиксировать в TASKS.md фактический результат primary system/performance gates только после зелёного runtime run.

### Technical Debt

- [ ] Разделить mocked browser fixture и real-system fixture, чтобы real mode был fail-closed при попытке зарегистрировать API mocks.
- [ ] Добавить явный assertion/telemetry, подтверждающий, что security-sensitive system requests были обслужены Worker, а не `route.fulfill`.

## 8. Analysis Methodology

**Strategy:** SURGICAL (202 файла; HIGH-risk test/runtime paths + 1-hop dependencies)

**Analysis Scope:**

- Исходный differential scope: 9/9 файлов (100%); remediation дополнительно изменил общую fixture, итоговый source scope — 10 файлов
- HIGH-risk изменения: 100%
- One-hop dependencies: Playwright auto-fixture, system runner, isolated DB safety, Worker observability middleware, PRD/TASKS acceptance criteria
- Baseline/history: `git log`, `git show`, `git blame`, `git log -S`

**Techniques:**

- Before/after differential analysis
- Security risk triage
- Trust-boundary tracing browser → Playwright route → Worker → DB/logs
- Test coverage mapping
- Quantitative blast-radius search with `rg`
- Adversarial regression modeling
- Validation through lint, TypeScript, unit/component suites and Playwright discovery

**Limitations:**

- Docker daemon недоступен, поэтому isolated PostgreSQL system/performance execution не проведён.
- Не выполнялся browser runtime без system DB; он не заменяет primary signal.
- Review ограничен текущим working tree и прямо связанными путями; production code не проходил полный security audit.

**Confidence:** HIGH для findings 1–3 (детерминированный control flow и конкретные line references), MEDIUM для общего release status до runtime system gate.

## 9. Appendix

### Acceptance Contract

Review считался завершённым, если:

1. Все 9 изменённых файлов классифицированы и просмотрены.
2. Security-sensitive browser requests прослежены до реального Worker/DB либо отмечена точка interception.
3. Log-safety failure path проверен на confidentiality и persistence.
4. Git history и удалённые security checks проверены.
5. Доступные secondary gates запущены; недоступный primary gate явно отмечен.

### Final Status

**Primary signal:** NOT MET  
**Secondary checks:** PASSED  
**Merge recommendation:** REJECT до устранения HIGH finding и зелёного real system E2E

## 10. Remediation Status — 2026-08-28

| Finding | Code status | Evidence | Remaining gate |
| --- | --- | --- | --- |
| System mocks bypass Worker | ✅ Исправлено в working tree | Primary-page mocks `/events` и `/feedback` теперь отключаются при `E2E_SYSTEM=1`; forged request secondary page остаётся real; добавлены real feedback GET и expected `400/404` guards | Runtime не подтверждён без Docker |
| Failure path раскрывает/сохраняет raw log | ✅ Исправлено в working tree | Scanner выводит только категории; files удаляются в `finally`; добавлен success/failure unit test | Runtime cleanup не подтверждён без Docker |
| Scanner false-positive/false-negative | ✅ Исправлено в working tree | Exact canaries для credentials/URL/password; key-aware matcher; safe `/api/v1/feedback` route test | Runtime log corpus не подтверждён без Docker |

**Post-remediation checks:** `bun run lint`, `bun run typecheck`, `bun run db:check` и `bun run test` проходят; scanner tests — 2 passed; Playwright discovery показывает 30 mocked tests, 2 system tests и 2 performance tests.  
**Blocked checks:** `test:e2e:system:docker`, `test:e2e:performance:docker` и `validate:stage12` останавливаются на отсутствующем Docker daemon.  
**Current release decision:** REJECT/NOT VERIFIED до запуска isolated PostgreSQL и обоих real Worker gates.
