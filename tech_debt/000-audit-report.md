# Ультра-глубокий baseline-аудит технического долга

Дата: 2026-08-27. Scope: текущая рабочая копия, включая незакоммиченные пользовательские изменения. Аудит read-only по production/test/config-коду; изменены только документы в `tech_debt/` и обязательный architecture review.

## Итог

Система не выглядит legacy-проектом, требующим переписывания. Ядро финансовых расчётов, tenant isolation, idempotency и build-artifact sanitation уже имеют сильные проверки. Главный долг — несоответствие между зрелостью feature set и качеством релизного сигнала/границ orchestration: mocked E2E сейчас почти полностью красный, real PostgreSQL gate не доказан в этом окружении, а крупные frontend/backend coordinators недостаточно характеризованы быстрыми тестами.

Подтверждённого критического security-дефекта или безопасно удаляемого крупного пласта кода не найдено. Это важный результат: «очистка» ради количества удалённых строк принесла бы больше риска, чем пользы.

## Фактические сигналы

- `bun run lint` — pass.
- `bun run typecheck` — pass.
- `bun run test` — pass, 109 тестов: contracts 16, backend 45, webapp 45, artifact 3.
- `bun run build` — pass; artifact sanitation и production bundle check проходят.
- `bun run test:e2e` — fail: 30 failed, 2 passed, 2 skipped из 34.
- `bun run audit` — завершает wrapper успешно, но сообщает 1 moderate advisory; прямой `bun audit --json` возвращает exit 1.
- `bun run db:check` — pass.
- `git diff --check` — pass.
- `tsc --noUnusedLocals --noUnusedParameters` для workspaces — pass.
- gitleaks в root audit — pass, секреты не найдены.

## Покрытие и тестопригодность

Coverage использован как карта риска, а не KPI.

- Backend fast suite: примерно 42% functions / 49% lines. `analytics/service.ts`, `onboarding/service.ts`, `products/service.ts`, `inventory/service.ts`, `settings/service.ts`, `events/service.ts` находятся примерно в диапазоне 5–12% line coverage; ряд HTTP handlers — 0%. Integration suite частично компенсирует это, но требует PostgreSQL/Docker и не является текущим быстрым сигналом.
- Webapp fast suite: примерно 61% functions / 74% lines. `overview-page.tsx` около 12% lines, `locations-page.tsx` около 15%; `AppShell`, Sales, Products, Inventory и Settings не получают meaningful direct coverage.
- Contracts: почти 100% lines; математическое/domain-ядро и demo generator покрыты хорошо.

Вывод: characterization добавляется первым шагом конкретного owning-refactor. Существующие integration tests не надо дублировать ради fast coverage; отдельные задачи 003/004 нужны только для действительно общих gaps/harness.

## Семь проходов code review

### 1. Wiring и интеграция — HIGH

- `webapp/e2e/fixtures.ts:8-34` считает любой `console.error` неожиданным, хотя сами specs моделируют ожидаемые 401/404/500. В результате guard ломает почти весь suite и перестаёт отличать дефект приложения от дефекта тестовой обвязки.
- Помимо guard найдены независимые failures: strict locator на семь `role=alert` (`accessibility.spec.ts:116`), скрытая desktop-table ячейка на mobile (`sales-products.spec.ts:286-288`), мобильные таймауты навигации (`analytics.spec.ts:332-343`, `first-run.spec.ts:167`).
- `webapp/src/components/app-shell.tsx:76-79` загружает полный Overview ради alert bell на каждой app-странице; сами Overview/Settings дополнительно запрашивают Overview (`overview-page.tsx:49-56`, `settings-page.tsx:51-54`). Это пока кандидат Stage 2: влияние следует измерить.

### 2. Ошибки и устойчивость — HIGH

- UI/API error states в основном явные и типизированные; пустых `catch`, скрывающих persistence failure, не найдено.
- Недостоверный E2E guard — реальный defect detection debt: ожидаемые HTTP-ошибки надо разрешать только opt-in и только для конкретного запроса/теста, сохраняя zero-tolerance к `pageerror`, неожиданным request failures и прочим console errors.
- Mutation-heavy компоненты содержат сложные recovery/invalidation ветки без прямой component-характеристики (`inventory-page.tsx:37-236`, `products-page.tsx:41-140`, `settings-page.tsx:41-135`).

### 3. Полнота — HIGH

- Stage 12 acceptance в `TASKS.md:436-440` не закрыт; mandatory journeys из `PRD.md:812-825` не имеют зелёного полного сигнала.
- Real Worker/PostgreSQL system journey пропускается без соответствующего окружения. Нельзя считать tenant negative cases доказанными только unit/typecheck сигналами.

### 4. Dead/legacy — LOW

- Unused imports/locals/parameters и явно неиспользуемые зависимости не подтверждены.
- `backend/src/demo/reset.ts:1` — рудиментарная граница из одного re-export. Удалять её отдельно нельзя: сначала перенести владельца reset-логики из onboarding service.
- Stage-имена тестов (`stage3.test.ts`, `stage4.test.ts`, `stage1-contracts.test.ts`, `stage4-contracts.test.ts`) стали историческими и ухудшают поиск ownership, но не влияют на runtime.

### 5. Bloat и god-components — MEDIUM/HIGH

- `backend/src/analytics/service.ts:415-1273` объединяет snapshot SQL, преобразование rows, period/location selection, расчёты и пять endpoint builders.
- `webapp/src/components/app-shell.tsx:51-204` координирует filters, profile, feedback, locations, alerts, telemetry, tour, logout и prompt state; с `:206-518` также владеет всем shell UI.
- Inventory (539 строк), Products (521) и Settings (393) смешивают mutation orchestration/recovery с крупными visual sections. Sales, Overview и Locations уже имеют локально ясные coordinators и функции-секции; их перенос между файлами оправдан только при повторном изменении, reuse или lazy-boundary trigger.
- `packages/contracts/src/index.ts` — 846 строк разных доменов; `webapp/src/lib/i18n.ts` — 753 строки словарей и runtime helpers; `backend/src/index.ts` — 671 строка route manifest и registrations.

### 6. Hardcoding и дублирование — MEDIUM

- Query-key prefixes вручную повторяются в `api/analytics.ts:38-129`, `inventory-page.tsx:66-100`, `products-page.tsx:57-68`, `settings-page.tsx:107`, `lib/reset-demo.ts:21-23`. Это correctness-риск при rename/invalidation.
- Hono request validation casts повторяются в доменных HTTP-модулях; регистрации `backend/src/index.ts:524-615` системно обходят типы через `as unknown as RouteHandler`.
- Business constants в большинстве случаев вынесены или закреплены PRD; подтверждённого опасного magic-number debt не найдено.

### 7. Security — MEDIUM

- Tenant scope серверный, RLS/negative cases присутствуют; утечек секретов в scan/build artifact не найдено.
- `bun audit --json` выявляет GHSA-67mh-4wv8-2f99 для `esbuild@0.18.20`, подтянутого `drizzle-kit → @esbuild-kit/esm-loader`. Это dev-server vulnerability, а не production Worker runtime exploit. Root audit явно предупреждает и по принятой severity policy блокирует high/critical; очистка moderate dev-only path — P2, если zero-advisory policy не принята отдельно.
- `backend/src/auth/http.ts:348-412` держит request transaction и DB connection на всём downstream handler. Это сохраняет transaction-local RLS, но создаёт потенциальный resource ceiling; менять можно лишь после измерений и без ослабления tenant context.

## Карта владельцев долга

| Область | Текущий владелец | Нужная граница |
|---|---|---|
| Release signal | Playwright fixture + specs | Строгий guard с точечными ожидаемыми HTTP failures |
| Frontend cache | Страницы и API-файлы | Typed query-key factories и явная mutation policy |
| Shell orchestration | `AppShell` | Небольшие hooks/components по существующим обязанностям |
| Analytics backend | Один service | Loader → pure calculations → endpoint presenters |
| Transport typing | Root route manifest | Доменные route registration/typed validation без double cast |
| Demo lifecycle | Onboarding service | Onboarding и demo reset как отдельные владельцы |

## Pruning verdict

Немедленно удалять production-код не рекомендуется. После задачи 013 можно удалить однослойный `backend/src/demo/reset.ts` либо превратить его в реального владельца — решение определяется итоговой границей imports. Остальные крупные файлы содержат активные пути; их надо разделять с сохранением поведения, а не вычищать по размеру.

## Рекомендуемый порядок

1. Сделать release gate честным (001–002).
2. Убрать локальные correctness/coupling hotspots (005, 006, 007a–007c, 009, 011), добавляя characterization первым шагом каждого владельца.
3. Закрыть только общие test gaps/harness (003–004), если owning tasks не покрыли их естественно.
4. Выполнить недорогую P2 ownership-гигиену (008, 010, 012–014) по реальному trigger.
5. Вернуться к 101–104 только с production-like измерениями и отдельным решением.
