# Differential Security Review: Stage 11 Settings, goal, feedback, events и Reset

Дата: 2026-08-26  
Baseline: `5c6db25b9fda849b1e4444531fe50234b3719f84` (`Implement Inventory Tracking and Movements`)  
Объект review: весь незакоммиченный worktree относительно `HEAD`, включая untracked-файлы  
Риск изменения: **HIGH** — новые аутентифицированные API, tenant-scoped persistence, auth-side effect и Reset flow  
Вердикт: **CONDITIONAL** — оба Medium finding устранены; перед release остаётся выполнить browser E2E с доступным Chromium

## Executive Summary

Изменение в целом сохраняет сильные существующие границы: tenant берётся из проверенной session, запрос выполняется в tenant transaction с RLS context, mutation body проходит strict Zod validation, feedback text не пишется в events/logs, а Reset остаётся одной транзакцией и не удаляет feedback/events. Cross-tenant read/write bypass в рассмотренном diff не найден.

В исходном diff `POST /events` действительно принимал все девять типов и не имел resource controls. В текущем worktree это исправлено: browser schema ограничена двумя navigation/filter типами, server-authoritative события проходят отдельный trusted helper, а новые client events ограничены 30 за 60 секунд и 300 за 24 часа на tenant. Retention сознательно оставлен задачей Stage 12; текущая quota ограничивает скорость роста и острый shared-database abuse.

| Severity | Количество | Статус |
| --- | ---: | --- |
| Critical | 0 | Не найдено |
| High | 0 | Не найдено |
| Medium | 2 | RESOLVED в текущем worktree |
| Low | 0 | Не выделено отдельно |
| Informational / coverage gaps | 3 | Учесть в hardening |

## Resolution

- **M-01 RESOLVED:** `productEventRequestSchema` принимает только `section_viewed`/`filter_changed`; семь business types доступны только `serverProductEventRequestSchema` и `recordServerProductEvent`.
- **M-02 RESOLVED:** добавлены tenant-scoped fixed windows 30/60 секунд и 300/24 часа через существующую `auth.rate_limits`, advisory locks, `429 RATE_LIMITED` и `Retry-After`. Replay существующего event не расходует квоту; server events quota не расходуют.
- Добавлены contract negative tests и изолированный integration test: server-only rejection, 30/31 burst, preseeded daily cap, tenant-safe behavior и server mutation после исчерпания client quota.
- PRD/TASKS обновлены; retention/cleanup явно вынесены в S12.16 до production rollout.

## What Changed

Diff включает 16 изменённых tracked-файлов и 12 новых implementation-файлов; сам отчёт — отдельный untracked-артефакт. Репозиторий содержит около 155 файлов, поэтому изменение затрагивает примерно шестую часть текущей поверхности.

Основные изменения:

- добавлены `PUT /settings/language`, `PUT /settings/revenue-goal`, `GET/PUT /feedback`, `POST /events`;
- добавлены server-side product events в login, onboarding, price, inventory, goal, feedback и Reset;
- прямые event inserts из product/inventory services заменены общим helper;
- добавлены Settings UI, глобальная feedback form/prompt, клиентские `section_viewed` и `filter_changed`;
- Reset вынесен в переиспользуемый dialog и добавлен в Settings;
- расширены shared response contracts, unit/component/integration/E2E tests;
- миграции и production dependencies не менялись: таблицы, enum, FK и RLS для feedback/events/targets существовали в baseline.

### Классификация изменённых поверхностей

| Риск | Файлы / группы | Причина |
| --- | --- | --- |
| High | `backend/src/auth/http.ts`, `backend/src/index.ts`, `backend/src/events/*`, `backend/src/settings/*`, `backend/src/onboarding/service.ts`, `backend/src/products/service.ts`, `backend/src/inventory/service.ts`, shared contracts | Auth, публичные writes, tenant scope, idempotency, Reset и telemetry integrity |
| Medium | `webapp/src/api/settings.ts`, Settings/AppShell/feedback/reset UI, product/inventory callers, integration/E2E/component tests | Новые mutation callers, client events, cache invalidation, conflict/retry behavior |
| Low | `TASKS.md`, i18n copy, prompt state tests | Документация, локализация и session-only UX state |

## Critical Findings

Critical и High findings не обнаружены.

## Medium Findings

### M-01. Публичный endpoint позволяет подделывать server-authoritative product events — RESOLVED

**Severity:** Medium  
**Категории:** CWE-345 (Insufficient Verification of Data Authenticity), CWE-20 (Improper Input Validation — trust semantics)  
**Уверенность:** High  
**Затронутые свойства:** integrity продуктовой аналитики и funnel/mutation metrics; не confidentiality и не tenant isolation

**Resolution:** исправлено в текущем worktree. Публичный request union теперь содержит только `section_viewed` и `filter_changed`; server-only union и helper отделены, а integration test проверяет отказ всех семи server types.

#### Evidence

- `packages/contracts/src/index.ts:773`–`826` теперь разделяет публичный `productEventRequestSchema` (два telemetry type) и `serverProductEventRequestSchema` (семь business type).
- `backend/src/events/http.ts:14`–`31` передаёт browser request только в `recordProductEvent`; rate-limit failure преобразуется в безопасный `429`.
- `backend/src/events/service.ts:80`–`123` валидирует только client union, а `:125`–`156` — отдельный server union; server helper генерирует event UUID самостоятельно.
- Те же типы создаются как authoritative server side effects: `backend/src/auth/http.ts:295`–`301`, `backend/src/onboarding/service.ts:430`–`437` и `525`–`532`, `backend/src/products/service.ts:108`–`117`, `backend/src/inventory/service.ts:219`–`230`, `backend/src/settings/service.ts:139`–`146`, `167`–`174` и `253`–`260`.
- Реальный web client отправляет через публичный endpoint только navigation telemetry — `section_viewed` и `filter_changed` (`webapp/src/components/app-shell.tsx:136`–`141`, `216`–`221`). Это соответствует границе доверия, которую API schema теперь явно выражает.
- Server-only metadata с UUID (`product_price_changed` и `inventory_movement_created`) больше не принимается публичным endpoint; trusted mutation paths передают эти значения после собственной tenant-scoped проверки.

#### Attacker model

Пользователь с выданным demo account, похищенной активной session cookie либо XSS в same-origin приложении. Администраторские или database credentials не нужны. `Origin` не является защитой от клиента, который сам формирует HTTP request.

#### Attack sequence

1. До исправления атакующий получал обычную authenticated completed-onboarding session.
2. До исправления он отправлял `POST /api/v1/events` с `type: "demo_reset"` или `type: "feedback_submitted"`.
3. Теперь тот же запрос не проходит публичную schema validation и получает `400` до service insert.
4. Реальные server events по-прежнему создаются только из trusted backend transactions с server-generated UUID.

#### Impact

Атакующий не выходит за RLS tenant и не меняет business state, но может произвольно искажать ключевой сигнал Stage 11: успешные login/onboarding, Reset, feedback и mutation adoption. Для Demo MVP, цель которого — оценить спрос и интерес владельцев, это существенное нарушение integrity. Воздействие ограничено analytics/admin SQL, потому что в текущем репозитории нет runtime readers `product_events`.

#### Historical context

- Union всех типов появился как предварительный contract в `49bf308` (`Define shared contracts and domain validation`).
- UUID/idempotency hardening добавлен в `dba5da3` (`feat: implement Stage 2 database foundation and contract hardening`).
- До этого diff реальные price/inventory events записывались только из server mutation services в `1830a4b` и `5c6db25`.
- Текущий diff впервые активировал общий union как публичный write boundary, одновременно сохранив server-authoritative writers. Регрессия возникла не из удаления старой проверки, а из неверного повторного использования заранее созданной schema на новой границе доверия; текущий worktree разделяет эти границы.

#### Recommendation

1. [x] Ввести отдельный public client union для `section_viewed`/`filter_changed`.
2. [x] Оставить `recordServerProductEvent` с typed input, недоступным browser request.
3. [x] Добавить negative integration test для всех server-only types; browser requests с UUID metadata этих типов отклоняются вместе с типом, а server paths используют tenant-scoped mutation context.

### M-02. У `POST /events` нет ограничителя неограниченного append и shared-database resource abuse — RESOLVED

**Severity:** Medium  
**Категории:** CWE-770 (Allocation of Resources Without Limits or Throttling), CWE-400 (Uncontrolled Resource Consumption)  
**Уверенность:** High  
**Затронутые свойства:** availability, Railway storage/compute cost, Worker/Hyperdrive latency

**Resolution:** исправлено в текущем worktree. Новые client events расходуют два tenant-scoped counters; превышение возвращает `429` с `Retry-After`, а server-authoritative mutation events обходят client quota.

#### Evidence

- `backend/src/events/service.ts:80`–`123` проверяет replay до quota и применяет лимит только к новым client events.
- `backend/src/events/rate-limit.ts:7`–`95` реализует counters 30/60 секунд и 300/24 часа с advisory locks и rollback в request transaction.
- `backend/src/events/http.ts:23`–`31` возвращает `429 RATE_LIMITED` и `Retry-After`.
- Server path (`backend/src/events/service.ts:125`–`156`) не расходует client quota.
- `product_events` остаётся append-only без retention (`backend/src/db/schema.ts:542`–`568`); это намеренно вынесено в Stage 12, но скорость роста ограничена tenant quota.

#### Attacker model

Обычный demo user либо атакующий с одной скомпрометированной session. Cross-origin browser CSRF не требуется: scripted client может выставить ожидаемый Origin и использовать принадлежащую ему cookie/session.

#### Attack sequence

1. Атакующий входит в один разрешённый account.
2. В цикле отправляет маленькие schema-valid события с уникальным UUID.
3. Первые 30 запросов за burst window принимаются, следующий получает `429`.
4. После 300 событий за 24-часовое окно дальнейшие client events также получают `429`.
5. Server mutation продолжает работать, а counters выполняются tenant-scoped и не дают одному tenant расходовать квоту другого.

#### Impact

Возможны рост database/storage bill, исчерпание Hobby quota, повышенная transaction/connection latency и отказ общей demo-среды. RLS не предотвращает resource exhaustion, поскольку изоляция логическая, а ресурс общий.

#### Historical context

- Таблица и tenant RLS созданы в `dba5da3`, но до этого diff не существовало публичного произвольного append endpoint.
- Login rate limiting и server-derived tenant context появились в `c21d75b`, показывая, что проект уже рассматривает abuse control как server responsibility.
- Новый route добавил новый blast radius; в текущем worktree он защищён tenant-scoped burst и daily quota.

#### Recommendation

1. [x] Ввести server-side rate limit по tenant с burst и sustained limits; возвращать `429 RATE_LIMITED`.
2. [x] Ограничить суточное количество событий на tenant; retention/cleanup policy вынесена в S12.16.
3. [x] Добавить advisory lock по event ID, чтобы replay не расходовал quota.
4. [x] Добавить integration test на превышение лимитов и server mutation bypass.

## Informational Observations

### I-01. Глобальный event primary key создаёт слабый cross-tenant existence oracle

`product_events.id` — глобальный primary key (`backend/src/db/schema.ts:546`), а insert конфликтует по нему до tenant-scoped read (`backend/src/events/service.ts:51`–`78`). Если атакующий уже знает UUID события другого tenant, ответ будет `409`, а для свободного UUID — `200`. UUIDv4 делает угадывание практически неосуществимым, содержимое строки не раскрывается, поэтому отдельная severity не назначена. Tenant-composite identity либо непрозрачный server-generated ID уберут этот side channel.

### I-02. Positive controls сохранены

- `requireAuthentication` устанавливает `database` и `auth.networkId` внутри одной transaction после authoritative session validation (`backend/src/auth/http.ts:327`–`377`).
- `product_events`, `feedback_responses`, `revenue_targets` имеют RLS tenant policy; event имеет composite `(network_id, user_id)` FK (`backend/src/db/schema.ts:511`–`568`).
- Event metadata — strict per-type objects, arbitrary feedback/form text отвергается (`packages/contracts/src/index.ts:741`–`826`).
- Error logger пишет generic message, method/path/requestId, а не body/feedback (`backend/src/index.ts:634`–`646`).
- Reset удаляет только demo orders/inventory/products/categories/targets, не feedback/events/preferences (`backend/src/onboarding/service.ts:271`–`279`), и выполняется в request transaction. `demo_reset` создаётся до commit в той же transaction (`backend/src/onboarding/service.ts:501`–`535`).

## Test Coverage

### Что покрыто

- shared contracts проверяют strict fields и запрет arbitrary event metadata;
- integration test проверяет goal save, feedback create/read, client event replay, rejected extra metadata, feedback preservation и наличие `feedback_submitted`/`demo_reset`;
- существующие database/integration tests покрывают RLS, tenant context, cross-tenant inventory/reset и atomic reset rollback/concurrency;
- component/unit tests покрывают feedback load/submit fields и tenant-scoped session prompt state;
- E2E mock journey покрывает goal, feedback reopen и Reset preservation UI.

### Пробелы

- negative test для browser submission server-authoritative event types добавлен;
- нет cross-tenant test именно для `/events`, goal и feedback API;
- abuse/rate-limit test для событий добавлен; retention остаётся Stage 12/S12.16;
- нет conflict/replay tests для goal и feedback, а также проверки единственного `demo_reset` event при idempotent replay;
- новый Playwright test mock-based и не доказывает реальную API/RLS/Reset интеграцию; Chromium E2E в текущем окружении не выполнен.

### Выполненная валидация

| Проверка | Результат |
| --- | --- |
| Contracts unit tests | 16 passed |
| Backend unit tests | 32 passed |
| Webapp unit/component tests | 33 passed |
| ESLint: contracts/backend/webapp | Passed |
| Typecheck + production builds + client-secret bundle check | Passed |
| Prettier check | Passed |
| `git diff --check` | Passed |
| Integration suite | 32 passed в изолированном Docker PostgreSQL |
| Playwright E2E | Не выполнен: Chromium отсутствует, загрузка браузера блокируется network policy (403) |

Root scripts требуют `bun` в `PATH`; проверки выполнены эквивалентными workspace-командами через `/home/agent/.bun/bin/bun`.

## Blast Radius

### Direct

- Новый общий event service вызывается из 6 backend modules: auth, onboarding/reset, products, inventory, settings и public event handler.
- Новые settings services доступны через 4 route definitions (плюс существующий `/settings/tour`) и global mutation/auth middleware.
- Shared schemas одновременно являются server validation и client request validation.

### Indirect

- Ошибка server event insert теперь откатывает соответствующую login/onboarding/business transaction; quota client events не блокирует server mutation path.
- Reset затрагивает Overview/Locations/Sales/Products/Inventory caches через tenant-prefix invalidation; Settings также использует Overview как read model цели.
- Feedback query живёт в AppShell и Settings, поэтому stale/error behavior влияет на глобальную feedback-кнопку и prompt.
- Product events пока читаются только администратором вне runtime code; разделение source boundary защищает единственный product-demand signal, а quota ограничивает shared resource abuse.

## Historical Context

| Commit | Security/architecture intent |
| --- | --- |
| `49bf308` | Ввёл shared strict contracts, event whitelist и metadata schemas |
| `dba5da3` | Создал PostgreSQL schema, RLS, FK, idempotency и UUID hardening |
| `c21d75b` | Ввёл authoritative session-to-tenant derivation и login abuse controls |
| `10b34df` | Ввёл atomic/idempotent onboarding и deterministic Reset lifecycle |
| `1830a4b` | Добавил server-side price mutation event с tenant user lookup |
| `5c6db25` | Добавил atomic inventory movement и server-side event; текущий baseline |

Текущий helper сохраняет прежнюю двойную проверку `(auth_user_id, network_id)` при поиске app user, а server callers не потеряли tenant scope. Исходный риск diff был в смешении trusted и untrusted event producers в одном публичном schema; текущий worktree разделяет producers и ограничивает client append.

## Prioritized Recommendations

### Перед merge

1. [x] Разделить client/server event contracts и запретить все server-authoritative types в `POST /events`.
2. [x] Добавить endpoint-specific rate limit/quota и negative integration tests для trust boundary и abuse.
3. Добавить cross-tenant API tests для events/feedback/goal и replay test для единственного Reset event.

### До production rollout

4. Определить retention и operational alert на рост `product_events`.
5. Решить, нужен ли явный `source` для аналитики; если да, миграция должна предшествовать Worker release.
6. Выполнить реальный Playwright journey с Chromium и полный integration suite из корректно настроенного Bun environment.

## Methodology, Limitations and Confidence

Использован focused differential workflow: полный tracked/untracked diff относительно `HEAD`, risk classification, трассировка browser → route/middleware → handler/service → contract → transaction/RLS/table, `rg`-карта callers/readers, `git log`/`git blame`/pickaxe для security-sensitive checks, adversarial abuse cases и оценка тестового покрытия.

Не выполнялись production writes, deployment или external calls. PostgreSQL integration suite выполнен на isolated Docker database; E2E не выполнен по указанному ограничению браузера. Уверенность **High** для resolution M-01/M-02: public contract, quota path и negative/abuse tests подтверждены статически и интеграционно.
