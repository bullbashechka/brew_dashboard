# Differential Security Review — текущий рабочий diff

Дата: 2026-08-25  
Ветка: `codex/dev`  
Baseline: `253dad1f67230e67628f2e7179fdaaf6f598e428` (`Bundle audit skills and correct demo weighting`)  
Scope: 9 изменённых файлов, `+330 / -69` до создания этого отчёта  
Стратегия: MEDIUM / focused review всех изменённых файлов и one-hop зависимостей

## Executive Summary

**Вердикт: security-блокеров не обнаружено; merge не требуется блокировать по результатам этого review.**

Изменения усиливают целостность pagination continuation: явно переданный `pageSize` теперь должен совпадать со значением внутри подписанного контекста. HMAC-проверка, привязка к endpoint, tenant/network, revision, временному окну и фильтрам сохранены. Изменения session retry, login errors, onboarding suggestions и guided tour не создают найденного обхода аутентификации, tenant isolation или серверной валидации.

Найден один LOW finding в тестах: часть новых negative-case assertions может не выполниться из-за условных ранних выходов. Это не runtime-уязвимость, но ослабляет способность suite поймать будущую регрессию continuation validation.

| Severity | Количество |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 1 |
| Informational coverage notes | 1 |

Уверенность: **высокая по статическому анализу**, **средняя по runtime-покрытию** из-за недоступного Bun/Chromium в текущем окружении и одного известного timeout полного integration suite.

## What Changed

| Область | Файлы | Изменение | Риск |
| --- | --- | --- | --- |
| Analytics pagination | `backend/src/analytics/http.ts`, integration test, `PRD.md` | Проверка совпадения `pageSize` с подписанным cursor/page context | High |
| Root session retry | `webapp/src/router.tsx` | Очистка exact session query и повторный запуск route loaders | High |
| Login/onboarding UX | `first-run-forms.tsx`, `i18n.ts`, unit test, `PRD.md` | Безопасное отображение login errors, локализация Zod errors, country suggestions | Medium |
| Guided tour | `app-shell.tsx` | Tour остаётся смонтированным между маршрутами | Medium |
| Locations sorting | `analytics/service.ts` | Эквивалентный refactor выбора sort value | Medium |

Проанализированы все изменённые файлы:

- `PRD.md`
- `backend/src/analytics/http.ts`
- `backend/src/analytics/service.ts`
- `backend/tests/integration/analytics.integration.test.ts`
- `webapp/src/components/app-shell.tsx`
- `webapp/src/components/first-run-forms.tsx`
- `webapp/src/lib/i18n.ts`
- `webapp/src/router.tsx`
- `webapp/tests/unit/first-run-forms.test.tsx`

## Findings

### [LOW] DR-001 — Pagination security assertions могут быть пропущены тестом

**Где:** `backend/tests/integration/analytics.integration.test.ts:202`, `:224`, `:240`

Тест завершает выполнение через `if (!cursor) return`, а проверки inventory cursor и page context обёрнуты в условные `if`. Если fixture или генератор данных перестанет выдавать continuation, suite может остаться зелёным, не проверив новые гарантии `pageSize` mismatch и tampered token.

**Security impact:** прямой exploit отсутствует; runtime-код продолжает выполнять проверку. Риск состоит в том, что будущая регрессия целостности continuation может пройти CI незамеченной.

**Рекомендация:** сделать fixtures детерминированно многостраничными и сначала явно утверждать наличие `nextCursor`/`pageContext`, например `expect(cursor).not.toBeNull()`, после чего выполнять negative cases без условного пропуска. Для TypeScript можно оставить guard с `throw`, но не успешный `return`.

**Приоритет:** исправить до merge либо ближайшим test-hardening follow-up; security-блокером текущего runtime diff не является.

### Runtime security findings

Critical/High/Medium runtime findings не обнаружены.

## Security Invariants Checked

### Continuation integrity and tenant binding

- Token по-прежнему проверяется HMAC-SHA-256 до разбора payload (`backend/src/analytics/http.ts:89-113`).
- Ключ доменно разделён строкой `brew-dashboard:analytics-cursor:` и использует только server-side secret (`backend/src/analytics/http.ts:65-70`).
- Continuation сравнивается с endpoint, `networkId`, revision, period, location, time window и status (`backend/src/analytics/http.ts:144-167`).
- Tenant берётся из проверенной session context, а не из query (`backend/src/analytics/http.ts:125-141`).
- Новая проверка отклоняет несовпадающий явно переданный `pageSize` (`backend/src/analytics/http.ts:170-181`, `:303`, `:390`). Если `pageSize` не передан, используется подписанное значение (`:315-318`, `:397-400`).
- `/sales` и `/inventory` остаются за `requireAuthentication` и `requireCompletedOnboarding` (`backend/src/index.ts:361-380`).

Результат: изменение усиливает binding continuation и не открывает cross-tenant или token-tampering путь.

### Session retry and route guards

- Retry удаляет только exact query `['session']` и вызывает `router.invalidate({ forcePending: true })` (`webapp/src/router.tsx:186-195`).
- Session повторно загружается через `/api/v1/auth/me`; `401` преобразуется в guest, остальные ошибки пробрасываются (`webapp/src/api/session.ts:11-32`).
- Destination/route decisions продолжают зависеть от свежего profile (`webapp/src/router.tsx:34-45`).

Результат: retry не подставляет profile и не обходит guard; он принудительно повторяет прежнюю проверку.

### Error disclosure and credential handling

- Login UI показывает status-derived сообщения: `401` — invalid credentials, `429` — rate limit, остальные — generic (`webapp/src/components/first-run-forms.tsx:111-125`).
- Raw API message не рендерится. Request ID проходит через React text rendering и не интерпретируется как HTML.
- Unit test проверяет отсутствие server error text и mapping `401`/`429` (`webapp/tests/unit/first-run-forms.test.tsx:37-64`).

Результат: изменение уменьшает риск раскрытия внутренних ошибок и не добавляет credential enumeration сверх существующих HTTP status semantics.

### Onboarding validation

- Client использует общий `onboardingRequestSchema`, а suggestions влияют только на значения формы (`webapp/src/components/first-run-forms.tsx:66-90`, `:286-350`).
- Серверная contract validation остаётся независимой; client suggestion не считается доверенным источником.
- Manual currency/timezone сохраняются при смене страны; неизвестная страна очищает только ранее автоматически заполненные значения.

Результат: обход серверной схемы или tenant boundary не найден.

### Sorting and guided tour

- `sortValue` заменяет две симметричные ternary-цепочки без изменения набора полей, numeric parsing, направления или tie-breakers (`backend/src/analytics/service.ts:1016-1045`).
- Tour теперь открыт для любого app route при `tourState === 'pending'`; persist по-прежнему выполняется существующим authenticated API. Это расширяет только UI lifecycle, не права доступа (`webapp/src/components/app-shell.tsx:71-73`, `:308-318`).

## Adversarial Analysis

| Attacker model / сценарий | Проверенный путь | Результат |
| --- | --- | --- |
| Авторизованный пользователь tenant B повторяет cursor tenant A | HMAC valid, затем `networkId` сравнивается со snapshot tenant B | `400 VALIDATION_ERROR`; данные tenant A не читаются |
| Клиент меняет `pageSize` в query при валидном cursor/page context | `assertContinuationPageSize` выполняется до выдачи страницы | `400 VALIDATION_ERROR` |
| Клиент меняет payload token или подпись | `crypto.subtle.verify` до `JSON.parse` результата | `400 VALIDATION_ERROR` |
| Клиент не передаёт `pageSize` при continuation | Размер берётся из подписанного payload | Pagination остаётся стабильной |
| Неавторизованный пользователь нажимает root retry | Session cache удаляется, `/auth/me` запрашивается снова, guard получает guest | Эскалации привилегий нет |
| Backend возвращает login error с чувствительным message | UI выбирает локальный текст по status и не рендерит raw message | Раскрытия message не найдено |
| Пользователь подменяет suggested onboarding fields | Поля проходят общий client contract и повторную server validation | Client-side suggestion не является trust boundary |

## Blast Radius Analysis

### Backend pagination

Прямой blast radius: `GET /api/v1/sales` (cursor и page context) и `GET /api/v1/inventory` (cursor). Косвенно затронуты web-клиенты, которые сохраняют continuation и явно повторяют `pageSize`. Token format не изменён: `pageSize` уже входил в `ContinuationPayload`; изменена только строгость проверки.

Failure mode совместимости: клиент, который намеренно менял `pageSize` между страницами, теперь получит документированный `400`. Это ожидаемое ужесточение, а не silent behavior change.

### Root session retry

Blast radius охватывает ошибки root route и все loaders, использующие общий session query. Очистка ограничена exact `sessionQueryKey`; analytics/data caches не удаляются. Основной риск — retry loop или неверная redirect-ветка при stale session, но прямого unit/E2E regression test для этого пути нет.

### First-run and tour

Login mapping действует только в `LoginForm`; onboarding suggestions — только в `OnboardingForm`; guided tour lifecycle — для onboarded profile с `tourState: pending`. Серверные auth/tenant/persistence слои не изменены.

### Locations sorting

Blast radius ограничен `buildLocations` и `/api/v1/locations`. Алгоритм сравнения и tie-breakers не изменены; security boundary не затронут.

## Test Coverage Analysis

| Изменённое поведение | Покрытие | Оценка |
| --- | --- | --- |
| Sales cursor `pageSize` mismatch | Integration assertion есть, но зависит от наличия cursor | Частичное |
| Sales pageContext `pageSize` mismatch | Integration assertion условная | Частичное |
| Inventory cursor `pageSize` mismatch | Integration assertion условная | Частичное |
| Tampered continuation | Unit + integration | Хорошее, integration имеет ранний выход |
| Login generic/401/429/request ID | Unit | Хорошее; нет отдельного assertion, что raw 401 text отсутствует, но rendered output проверен косвенно |
| Country suggestions/manual override/clear | Unit | Хорошее для основных переходов |
| Localized Zod errors | Duplicate/generic покрыты; полный RU/key matrix не покрыт | Частичное |
| Guided tour между app routes | `GuidedTour` unit проверяет navigation; AppShell mount condition напрямую не тестируется | Частичное |
| Root session retry | Прямого теста не найдено | Пробел |
| Locations sort refactor | Существующие analytics integration/component проверки, без полного sort matrix | Частичное |

**Informational coverage note:** добавить unit/router test для `RootError`: session query удаляется, loader повторяется, guest получает login redirect, authenticated profile возвращается в app. Это прежде всего resilience/auth-state regression coverage, не свидетельство текущего обхода guard.

## Historical Context

Изучены history/blame и owning commits:

- `ad495c2` — первоначальные analytics endpoints и continuation logic;
- `6e1b477` — analytics/dashboard/reset изменения;
- `3411d8f` — first-run flow и guided tour;
- `f733737` — shell и routing foundation;
- `c21d75b` — authentication/account administration context.

`git log -S/-G` по удалённым условиям и изменённым patterns не показал, что diff откатывает прежний security fix. Удалённых auth middleware, tenant checks, token verification или server validation в текущем diff нет.

## Recommendations

1. Укрепить pagination integration fixture и заменить успешные conditional skips явными assertions — DR-001.
2. Добавить прямой router test для root session retry и повторного guard decision.
3. При наличии CI с PostgreSQL и Playwright прогнать полный integration и E2E suite перед merge.
4. Не менять текущий runtime подход к continuation binding: проверка находится на правильном owner layer и использует уже подписанный context.

## Validation and Limitations

В рамках review выполнены:

- `git diff --check` — успешно;
- полный статический просмотр 9 changed files и one-hop зависимостей;
- route/auth/contract tracing от query schema до middleware, handler, continuation verification и analytics service;
- `git log`, `git show`, `git blame`, `git log -S/-G` по изменённым путям;
- поиск тестов и всех прямых consumers изменённых symbols.

На том же рабочем diff до этого review были зафиксированы результаты:

- `bun run lint` — успешно, одна существующая warning в `settings.lazy.tsx`;
- `bun run typecheck` — успешно;
- `bun run test` — успешно;
- `bun run build` — успешно;
- целевые analytics integration scenarios — успешно;
- полный integration suite — 24 pass / 1 известный timeout в onboarding `afterAll` hook;
- E2E не запущен: отсутствует Playwright Chromium, загрузка заблокирована network policy.

Повторный запуск `bun run test` и `bun run typecheck` из текущей review-сессии не стартовал: executable `bun` отсутствует в `PATH` (`exit 127`). Это ограничение окружения, не падение тестов кода. Поэтому primary runtime signal считается **частично подтверждённым**, а не полностью воспроизведённым этим review.

## Methodology

Review выполнен по differential-review методике: baseline и scope inventory, risk triage, полный разбор high-risk diff, one-hop dependency tracing, git-history проверка, blast-radius mapping, test-gap analysis и adversarial моделирование. Отчёт оценивает только текущий diff относительно указанного baseline; существующие вне diff проблемы не повышались до findings без доказанной связи с изменением.
