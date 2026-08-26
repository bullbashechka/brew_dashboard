# Differential security review: Этап 10 Inventory

Дата: 2026-08-26  
Объект: незакоммиченный worktree относительно `1830a4b5518c06cd32a36babe3e6a3f155a3cb31` (`Implement Sales Analytics And Product Pricing`)  
Стратегия: FOCUSED для MEDIUM-репозитория, 100% HIGH-risk поверхности и зависимости на один переход

## Executive Summary

| Severity | Count |
| --- | ---: |
| 🔴 CRITICAL | 0 |
| 🟠 HIGH | 0 |
| 🟡 MEDIUM | 0 |
| 🟢 LOW | 0 |

**Overall Risk:** LOW  
**Recommendation:** CONDITIONAL — функциональные и security-проверки пройдены; Playwright browser journey не может быть запущен в данном окружении из-за сетевого запрета на загрузку Chromium.

Критических security-регрессий в новом `POST /inventory/movements` не обнаружено. Endpoint наследует authoritative session, same-origin/JSON/body-limit middleware и tenant transaction; клиент не передаёт `networkId`. SQL использует параметры, database function повторно фиксирует tenant из `app.network_id`, блокирует balance row и не допускает отрицательный остаток. Replay одной операции не создаёт второй movement или product event.

Все обнаруженные findings исправлены и подтверждены unit/integration-тестами. Остаётся только выполнить E2E journey в окружении, где доступна загрузка/установка Playwright Chromium.

**Key Metrics:**

- изменённых файлов проанализировано: 16/16 (100%);
- дополнительно проверено 9 security/data-flow зависимостей;
- объём worktree: +1 537 / -19 строк, включая 675 строк в новых untracked-файлах;
- HIGH-risk mutation chains: 1;
- подтверждённых security regressions: 0;
- закрытых существенных test gaps: 4 сценария;
- удалённых auth/tenant/validation/security checks: 0.

## Resolution (2026-08-26)

| Предыдущее finding | Статус | Подтверждение |
| --- | --- | --- |
| MEDIUM: форма не восстанавливается после `409` | RESOLVED | target формы хранит snapshot независимо от status-filter; фоновая unfiltered-загрузка обновляет balance/revision, а явный Retry создаёт новый idempotency key без потери quantity. Component-тест покрывает retry; E2E journey добавлен. |
| MEDIUM: недостаточно integration coverage mutation | RESOLVED | Добавлены HTTP-test reuse key с изменённым payload, exact threshold transitions, stale revision после Reset и fault-injection rollback после DB function. `test:integration:docker`: 30/30. |
| LOW: receipt получает семантически неверную ошибку `23514` | RESOLVED | PostgreSQL error code извлекается также из `cause`; receipt upper-bound возвращает type-aware conflict вместо сообщения о writeoff. |

Дополнительно устранён hooks dependency warning в `AppShell` и восстановлен format gate. Единственный lint warning находится в уже существовавшем `webapp/src/pages/settings.lazy.tsx` и не относится к изменённому пути.

## Findings

### 🟡 MEDIUM: после `409 CONFLICT` форму нельзя повторно отправить без потери ввода

**Status:** RESOLVED

**Files:**

- `webapp/src/components/inventory-movement-dialog.tsx:68`
- `webapp/src/components/inventory-movement-dialog.tsx:74`
- `webapp/src/components/inventory-movement-dialog.tsx:155`
- `webapp/src/components/inventory-movement-dialog.tsx:192`
- `webapp/src/components/inventory-movement-dialog.tsx:207`
- `webapp/src/pages/inventory.lazy.tsx:85`
- `webapp/src/pages/inventory.lazy.tsx:123`

**Commit:** незакоммиченный worktree поверх `1830a4b`  
**Blast Radius:** один общий Receipt/Write off dialog, все tenant inventory mutations из UI  
**Test Coverage:** NO для conflict/retry

`onError` при конфликте обновляет Inventory и Overview, но оставляет `movement.error`. Dialog вычисляет `conflict === true` и безусловно блокирует submit. Изменение quantity сбрасывает idempotency key, но не очищает ошибку. Единственный выход — закрыть dialog; закрытие одновременно очищает quantity и тем самым нарушает заявленное сохранение ввода при ошибке.

При активном status-фильтре последствие хуже: `selectedBalance` вычисляется только из уже отфильтрованного `balances`. После conflict-refetch строка может сменить статус или исчезнуть после Reset, тогда открытый dialog теряет всё содержимое формы и остаётся только закрыть его.

**Сценарий воспроизведения:**

1. Открыть Write off в двух вкладках либо открыть форму до Reset в другой вкладке.
2. Во второй вкладке изменить тот же balance или выполнить Reset.
3. В первой вкладке отправить сохранённое quantity и получить `409 CONFLICT`.
4. Дождаться refetch актуального balance.
5. Submit остаётся disabled; изменение quantity его не включает.
6. Закрытие формы удаляет введённое значение. При status-фильтре тело dialog может исчезнуть сразу после refetch.

**Recommendation:**

- после conflict-refetch разрешать новую попытку: очищать conflict error при изменении quantity и создавать новый idempotency key;
- обновлять `expectedDemoDataRevision` из актуального ответа;
- хранить target/draft отдельно от отфильтрованного списка, чтобы dialog не терял содержимое;
- добавить component tests для concurrent-balance conflict, stale revision и исчезновения строки из status-фильтра.

### 🟡 MEDIUM: high-risk mutation не имеет заявленного полного integration coverage

**Status:** RESOLVED

**Files:**

- `TASKS.md:365`
- `backend/tests/integration/analytics.integration.test.ts:301`
- `backend/tests/integration/database.integration.test.ts:174`
- `backend/tests/integration/database.integration.test.ts:233`
- `webapp/tests/unit/inventory-movement-dialog.test.tsx:47`

**Commit:** незакоммиченный worktree поверх `1830a4b`  
**Blast Radius:** balance + movement ledger + idempotency + product event в одной request transaction  
**Test Coverage:** PARTIAL

`S10.9` помечен выполненным, однако добавленное HTTP integration покрытие проверяет receipt, replay, удаление alert, один event, oversized writeoff и cross-tenant UUID. Database suite проверяет idempotency и конкурентные writeoff. Не покрыты следующие важные ветви:

1. handler-level atomic rollback после того, как database function уже изменила balance/movement, но последующий `product_events` insert или response loading упал;
2. полный набор threshold transitions: `out_of_stock ↔ low_stock ↔ in_stock` на точных границах `0` и `min_threshold`;
3. stale `expectedDemoDataRevision` для нового endpoint;
4. reuse одного idempotency key с изменённым payload через HTTP.

Архитектурно rollback выглядит корректно: auth middleware держит handler внутри одной PostgreSQL transaction, а исключение откатывает function, idempotency row и event. Но для HIGH-risk state mutation это должно быть доказано fault-injection тестом, а не только выведено из структуры кода.

Дополнительное ограничение: Bun отсутствует в окружении review, поэтому новые unit/integration/E2E тесты фактически не запускались.

**Recommendation:**

- добавить integration hook/fault injection после `apply_inventory_movement`, до `productEvents` insert, и проверить неизменность balance, movement count, idempotency и events;
- добавить точные threshold-boundary cases;
- добавить HTTP tests для stale revision и idempotency-key conflict;
- выполнить `bun run test`, `bun run test:integration:docker` и `bun run test:e2e` до merge.

### 🟢 LOW: допустимый контрактом receipt может пересечь DB limit и получить ошибку про writeoff

**Status:** RESOLVED

**Files:**

- `packages/contracts/src/index.ts:48`
- `packages/contracts/src/index.ts:60`
- `backend/src/inventory/service.ts:105`
- `backend/src/db/schema.ts:425`
- `backend/drizzle/0001_security.sql:103`

**Commit:** новый API в worktree использует ограничения из `dba5da3`  
**Blast Radius:** только экстремальные receipt quantities  
**Test Coverage:** NO

Контракт принимает quantity до `99 999 999 999.999` по формату, а balance обязан оставаться меньше `100 000 000 000`. Receipt максимального допустимого quantity при ненулевом остатке нарушает `inventory_balances_on_hand_format_check` (`23514`). `databaseProblem` трактует любой `23514` как `Write off exceeds current balance`, даже если запрос был receipt.

Операция откатывается и данные не повреждаются, поэтому impact низкий. Но публичный контракт принимает запрос, который неизбежно получает семантически неверную ошибку.

**Пример:** balance `5.000` + receipt `99999999999.000` → DB check violation → `409 CONFLICT: Write off exceeds current balance`.

**Recommendation:** после row lock отдельно проверять верхнюю границу результирующего receipt balance и возвращать type-aware problem; добавить тест максимальной границы. Не сопоставлять все `23514` с writeoff overdraw без проверки constraint/type.

## What Changed

**Commit Range:** `1830a4b..working-tree`  
**Commits:** 0; изменения ещё не закоммичены  
**Timeline:** 2026-08-23 — 2026-08-26

`49bf308 contracts` → `dba5da3 DB/RLS/function` → `c21d75b auth/mutation security` → `1830a4b base HEAD` → `working tree Stage 10`

| File | +Lines | -Lines | Risk | Blast Radius |
| --- | ---: | ---: | --- | --- |
| `TASKS.md` | 10 | 10 | LOW | LOW |
| `backend/src/index.ts` | 34 | 0 | HIGH | HIGH |
| `backend/src/inventory/http.ts` | 23 | 0 | HIGH | MEDIUM |
| `backend/src/inventory/service.ts` | 213 | 0 | HIGH | HIGH |
| `backend/tests/integration/analytics.integration.test.ts` | 118 | 0 | LOW | LOW |
| `backend/tests/integration/database.integration.test.ts` | 52 | 0 | LOW | LOW |
| `packages/contracts/src/index.ts` | 13 | 0 | MEDIUM | HIGH |
| `packages/contracts/tests/stage1-contracts.test.ts` | 35 | 0 | LOW | LOW |
| `webapp/src/api/analytics.ts` | 34 | 0 | MEDIUM | MEDIUM |
| `webapp/src/components/app-shell.tsx` | 9 | 1 | MEDIUM | MEDIUM |
| `webapp/src/components/inventory-movement-dialog.tsx` | 227 | 0 | MEDIUM | MEDIUM |
| `webapp/src/lib/i18n.ts` | 82 | 0 | LOW | LOW |
| `webapp/src/pages/inventory.lazy.tsx` | 467 | 5 | MEDIUM | MEDIUM |
| `webapp/src/router.tsx` | 8 | 3 | MEDIUM | LOW |
| `webapp/tests/unit/inventory-movement-dialog.test.tsx` | 103 | 0 | LOW | LOW |
| `webapp/e2e/inventory.spec.ts` | 109 | 0 | LOW | LOW |

**Total:** +1 537 / -19 строк в 16 файлах.

Основной data flow:

`InventoryMovementDialog` → `createInventoryMovement` → authenticated Hono route → `createInventoryMovement` service → `app.apply_inventory_movement` → balance + ledger + idempotency → product event → Inventory/Overview cache invalidation.

## Test Coverage Analysis

### Покрытые сценарии

| Сценарий | Evidence | Статус |
| --- | --- | --- |
| positive quantity / enum-only type | shared Zod contract + contract test | Covered statically |
| tenant берётся из session | `requireAuthentication` + service input | Covered by design |
| cross-tenant UUID substitution | `analytics.integration.test.ts:405` | Covered, not executed here |
| identical replay | `analytics.integration.test.ts:339` | Covered, not executed here |
| duplicate event suppression | `analytics.integration.test.ts:375` | Covered, not executed here |
| overdraw rejection | `analytics.integration.test.ts:392` | Covered, not executed here |
| concurrent writeoffs | `database.integration.test.ts:233` | Covered, not executed here |
| alert disappears after receipt | `analytics.integration.test.ts:349` | Covered, not executed here |
| UI duplicate click lock | `inventory-movement-dialog.test.tsx:81` | Covered, not executed here |

### Непокрытые изменения

| Function / flow | Risk | Impact |
| --- | --- | --- |
| conflict → refetch → retry | MEDIUM | пользователь не может повторить ввод |
| post-function event failure | HIGH | atomic rollback не доказан end-to-end |
| exact threshold transitions | MEDIUM | возможная ошибка status/alert на границе |
| stale revision и changed-payload replay через HTTP | HIGH | concurrency/idempotency ветви не проверены на route уровне |
| receipt у верхней границы balance | LOW | неверный problem response |

Оценка line coverage не вычислялась: тестовый runtime Bun недоступен. Структурно тестами затронуто большинство новых happy-path и security branches, но полное покрытие high-risk mutation подтвердить нельзя.

## Blast Radius Analysis

| Surface | Direct consumers / effects | Risk | Priority |
| --- | --- | --- | --- |
| `POST /inventory/movements` | 1 UI caller, любой authenticated completed tenant user | HIGH | P0 |
| backend `createInventoryMovement` | route handler, DB function, event ledger | HIGH | P0 |
| `app.apply_inventory_movement` | service, Hyperdrive smoke, DB integration tests | HIGH | P0 |
| mutation request schema | 5 producer/consumer/test files | MEDIUM | P1 |
| mutation response schema | 6 producer/consumer/test files | MEDIUM | P1 |
| Inventory invalidation prefix | все Inventory filter variants текущего tenant | MEDIUM | P1 |
| Overview invalidation prefix | badge/dropdown и все Overview filter variants tenant | MEDIUM | P1 |

Потенциально изменяемые сущности одной успешной операции: `inventory_balances`, `inventory_movements`, `idempotency_keys`, `product_events`. Все выполняются внутри request transaction.

## Adversarial Analysis

Модель атакующего: аутентифицированный пользователь одного tenant, способный менять request JSON, повторять запросы, подставлять UUID другого tenant и создавать конкурентные запросы; отдельно рассмотрен cross-site origin.

| Вектор | Защита / evidence | Вывод |
| --- | --- | --- |
| запрос без session | `requireAuthentication` до route handler | blocked |
| CSRF / cross-origin POST | exact Origin + JSON-only + 256 KiB limit | blocked |
| client-supplied tenant | `networkId` отсутствует в контракте, берётся из session | blocked |
| foreign item/location UUID | tenant-scoped queries + composite FK/function checks; HTTP test ожидает 404 | blocked |
| SQL injection через quantity/type/UUID | bound SQL parameters + enum/uuid/numeric casts | blocked |
| повтор одинакового запроса | idempotency row lock, replay до function/event | blocked |
| reuse key с другим payload | operation + SHA-256 request hash conflict | blocked by code; HTTP test gap |
| два writeoff по 4 из balance 5 | balance `FOR UPDATE`; один commit, один rollback | blocked by code/test |
| fractional `pcs` / >3 decimals | Zod format + database function unit/precision checks | blocked |
| stale demo revision / Reset race | network lock + locked revision comparison | blocked by code; UX recovery broken |
| failure после DB function | outer request transaction должна откатить все записи | likely blocked; fault-injection test gap |

Exploitability security bypass: **не подтверждена**. Наиболее реалистичный злоупотребляющий сценарий — tenant-local генерация корректно откатываемых конфликтов/ошибок; доступа к данным другого tenant и отрицательного stock не получено.

## Historical Context

- `49bf308` (2026-08-23) добавил shared `inventoryMovementMutationSchema`.
- `dba5da3` (2026-08-23) добавил RLS, revoke прямого runtime DML и `SECURITY DEFINER app.apply_inventory_movement`.
- `33b6b77` (2026-08-24) расширил Hyperdrive isolation validation для database function.
- `c21d75b` (2026-08-24) добавил authoritative authentication и mutation security middleware.
- `1830a4b` (2026-08-26) является текущим baseline и содержит общую idempotency инфраструктуру.

**Security-related removals:** не обнаружены. Diff не удаляет auth, tenant, origin, quantity, idempotency, lock, RLS, role, grant/revoke или policy checks. Удалённые совпадения относятся только к переключению Stage 10 checkboxes в `TASKS.md`.

**Regression risks:** новый endpoint впервые соединяет существующую DB function с публичным HTTP/UI path. Поэтому основной риск находится не в удалении baseline-защит, а в корректности error recovery и доказательстве транзакционного rollback всей новой цепочки.

## Validation Results

| Check | Result |
| --- | --- |
| `git diff --check` | PASS |
| `bun run format` / `bun run lint` | PASS; один existing unrelated warning в `settings.lazy.tsx` |
| `bun run typecheck` | PASS |
| `bun run test` | PASS: 77 tests (contracts 15, backend unit 32, webapp unit 30) |
| `bun run test:integration:docker` | PASS: 30 tests |
| `bun run build` | PASS; включая `check:client-secrets` |
| `bun run test:e2e` | BLOCKED: Playwright Chromium отсутствовал; его загрузка через `bun x playwright install chromium` блокируется policy (403) |

Для запуска checks установлен Bun `1.3.14` в `/home/agent/.bun/bin/bun`. Перед повторным integration-run был удалён и создан заново только disposable Docker volume/container `postgres-test`, оставшийся от прерванного запуска.

## Recommendations

### Immediate (Blocking)

- [x] Исправить conflict/retry flow без потери quantity.
- [x] Добавить component test для `409` и status-filter disappearance.
- [x] Добавить handler-level atomic rollback fault-injection integration test.
- [x] Отформатировать файлы и устранить новый hooks warning.
- [x] Запустить штатные checks в Bun-окружении, кроме недоступного browser E2E.
- [ ] Запустить `bun run test:e2e` в окружении с доступным Playwright Chromium.

### Before Production

- [x] Добавить exact threshold transition tests.
- [x] Добавить HTTP stale-revision и changed-payload idempotency tests.
- [x] Сделать ошибку верхней границы receipt type-aware.
- [x] После успешной валидации отметить критерии приёмки Stage 10 в `TASKS.md`.

### Technical Debt

- [ ] Централизовать typed query-key factories, чтобы mutation invalidation не дублировала строковые prefixes.

## Analysis Methodology

**Strategy:** FOCUSED, так как репозиторий содержит 103 TS/TSX-файла и попадает в диапазон MEDIUM.

**Analysis Scope:**

- changed files: 16/16;
- HIGH-risk files: 100%;
- one-hop dependencies: auth middleware, mutation middleware, tenant transaction, idempotency, schema/RLS, DB function, analytics/alerts, revision check;
- LOW-risk unchanged files вне связанного пути не анализировались.

**Techniques:**

- diff triage и line-level review;
- `git log -S` для security primitives;
- поиск удалённых security checks;
- producer/consumer blast-radius search;
- review shared contracts и обеих сторон API;
- adversarial моделирование tenant substitution, CSRF, replay и concurrency;
- статические typecheck/lint/format checks;
- сопоставление с PRD и Stage 10 acceptance criteria.

**Limitations:**

- нет commit/PR range: review выполнен для незакоммиченного worktree;
- browser journey не исполнялся: сетевой policy блокирует скачивание Chromium;
- coverage percentage и dependency CVEs не оценивались;
- review не является полным аудитом всего репозитория.

**Confidence:** HIGH для проанализированного mutation/security path и integration coverage; MEDIUM для общей merge-readiness только из-за недоступного browser E2E.

## Appendix: Baseline Invariants

Проверенные и сохранённые инварианты:

1. tenant определяется только authoritative session;
2. transaction устанавливает `app.network_id` до tenant data access;
3. runtime role не может напрямую менять balances/movements;
4. database function получает tenant из server transaction context;
5. writeoff выполняется после row lock и не может опустить balance ниже нуля;
6. request payload входит в tenant-scoped idempotency hash;
7. movement, balance, idempotency completion и event находятся в одной transaction;
8. stock alerts вычисляются из актуальных balances, persistent alert lifecycle не добавлен;
9. edit/delete endpoints для movements не добавлены.
