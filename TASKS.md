# Brew Dashboard — этапы и задачи Demo MVP

**Версия плана:** 0.2

**Дата:** 2026-08-23

**Источник требований:** `PRD.md`, Demo MVP 0.2

## Как работать с планом

- Этапы выполняются по порядку; задачи внутри этапа можно распараллеливать только после выполнения указанных зависимостей.
- `[ ]` — не начато, `[x]` — завершено. Этап закрывается только после выполнения всех его задач и критериев приёмки.
- Для каждой фичи действует Definition of Done из раздела 23 `PRD.md`: desktop/mobile, нужные состояния интерфейса, RU/EN, общий контракт и серверная валидация, tenant isolation, безопасные логи и соразмерные тесты.
- Любое изменение общего контракта проверяется одновременно на стороне React и Hono.
- Применённые PostgreSQL migrations не редактируются: изменения Drizzle schema оформляются новой versioned SQL migration.
- Destructive integration/E2E операции разрешены только для аккаунтов `account_kind = 'e2e'`; runner обязан проверить этот признак до mutation или cleanup.
- Функции из раздела 3.2 `PRD.md` не реализуются и не должны появляться в UI или API.

## Сквозной критерий результата

План завершён, когда администратор может безопасно выдать до 15 персональных доступов, а каждый владелец — войти, настроить сеть из 1–5 точек, изучить согласованную RU/EN аналитику на desktop и mobile, выполнить три разрешённые группы изменений, восстановить демо-набор и отправить обратную связь, не получив доступа к данным другого аккаунта.

---

## Этап 0. Подготовить рабочую основу монорепозитория

**Цель:** получить минимальный собираемый Bun workspace без устаревших частей исходного шаблона.

**Зависимости:** нет.

### Задачи

- [x] **S0.1.** Зафиксировать версию Bun и создать root workspace с активными пакетами `webapp`, `backend` и `packages/contracts`.
- [x] **S0.2.** Поднять `webapp` на React, TypeScript и Vite; подключить TanStack Router, TanStack Query, TanStack Form, Tailwind CSS, shadcn/ui, Recharts и Playwright.
- [x] **S0.3.** Поднять `backend` на Hono с Zod/OpenAPI и Cloudflare Workers runtime.
- [x] **S0.4.** Настроить единый Worker: Hono обслуживает `/api/*`, Vite SPA — статические assets, неизвестные client routes получают `index.html`.
- [x] **S0.5.** Удалить из active workspace и lockfile неиспользуемые части шаблона: Astro/website, mobile, Prisma, старую standalone PostgreSQL-реализацию, старую JWT/auth-модель, email/reset, роли, media storage, background jobs, Terraform и старые cloud runbooks.
- [x] **S0.6.** Добавить root-команды `dev`, `lint`, `typecheck`, `test`, `test:integration`, `test:e2e` и `build`; каждая команда должна запускать соответствующие workspace-задачи.
- [x] **S0.7.** Описать локальный environment contract без значений секретов; гарантировать, что database credentials и auth secrets не доступны Vite-коду.
- [x] **S0.8.** Настроить базовые lint, formatting, TypeScript и test conventions для всех workspace.

### Критерии приёмки

- [x] `bun install`, `bun run lint`, `bun run typecheck`, `bun run test` и `bun run build` определены в корневом `package.json` и завершаются успешно на чистой установке.
- [x] Локально открывается SPA, а `GET /api/v1/health` обрабатывается тем же Worker origin.
- [x] В active workspace, lockfile и scripts нет удалённых технологий и неиспользуемых deployment-команд.
- [x] Ни один server secret не попадает в client bundle или tracked files.

---

## Этап 1. Зафиксировать общие контракты и доменные правила

**Цель:** создать единый типизированный источник входных данных, ответов, ошибок и расчётов до реализации экранов.

**Зависимости:** этап 0.

### Задачи

- [x] **S1.1.** В `packages/contracts` определить общий success/error envelope с `requestId`, `data`, `meta`, field errors и кодами ошибок из PRD.
- [x] **S1.2.** Описать Zod-контракты login, language, onboarding, profile/session state и фиксированных значений `period`.
- [x] **S1.3.** Описать query-контракты `locationId`, period, cursor/page и ответы Overview, Locations, Sales, Products и Inventory.
- [x] **S1.4.** Описать mutation-контракты изменения цены, inventory receipt/writeoff, месячной цели, языка, tour state, feedback и reset.
- [x] **S1.5.** Описать whitelist product events и отдельную schema metadata для каждого допустимого type; запретить произвольный текст и чувствительные поля.
- [x] **S1.6.** Реализовать серверные доменные функции для Revenue, COGS, Gross Profit, Gross Margin, Orders, Average Check, Current Unit Margin и Goal Completion.
- [x] **S1.7.** Реализовать периодные границы и comparison: `Today` против вчера до того же локального времени, а остальные периоды — против непосредственно предыдущего окна той же длительности.
- [x] **S1.8.** Реализовать stock statuses, stock alerts, sales-drop condition и menu engineering относительно медиан активных товаров.
- [x] **S1.9.** Зафиксировать правила `N/A`, исключения cancelled orders, historical price/cost snapshots, UTC storage и группировки в IANA timezone сети.
- [x] **S1.10.** Добавить unit tests для формул, zero division, timezone boundaries, comparison, menu matrix, stock statuses, alerts, schemas, generator helpers и event whitelist.

### Критерии приёмки

- [x] React и Hono импортируют схемы и типы из `packages/contracts`, не дублируя DTO.
- [x] Неизвестные mutation fields отклоняются, а допустимые значения period/event ограничены контрактом.
- [x] Деньги рассчитываются без binary floating-point ошибок, cancelled orders не участвуют в метриках.
- [x] Unit tests покрывают положительные, граничные и отрицательные случаи доменных правил.

---

## Этап 2. Создать схему Railway PostgreSQL и tenant boundaries

**Цель:** подготовить целостную БД, в которой данные каждого аккаунта физически и логически ограничены одной сетью.

**Зависимости:** этап 1.

### Задачи

- [x] **S2.1.** Создать один Railway Hobby PostgreSQL service и cache-disabled Hyperdrive configuration; привязать `HYPERDRIVE`, затем подключить Drizzle ORM/Kit, создать server-only schema source и каталог `backend/drizzle` для versioned SQL migrations.
- [x] **S2.2.** Подготовить server-only Better Auth tables, `networks` и `app_users` с nullable onboarding-полями, уникальными `login_normalized` и `network_id`, status, `account_kind`, expiry, login/tour timestamps и связью с Better Auth user.
- [x] **S2.3.** Создать `locations`, `categories`, `products`, `orders`, `order_items`, `inventory_items`, `inventory_balances`, `inventory_movements`, `revenue_targets`, `feedback_responses`, `product_events` и `demo_generations`.
- [x] **S2.4.** Применить UUID, `timestamptz` и exact-scale `numeric` для money/quantity: money ограничены диапазоном `numeric(14,2)`, quantity — `numeric(14,3)`, но scale проверяется constraint до записи, чтобы PostgreSQL не выполнял silent rounding; также добавить необходимые `created_at`/`updated_at`.
- [x] **S2.5.** Добавить foreign keys, unique/check constraints и запрет orphan records; проверить принадлежность связанных UUID одной сети на write path.
- [x] **S2.6.** Добавить tenant и time-series индексы, включая `network_id`, `(network_id, occurred_at)` и `(network_id, location_id, occurred_at)` там, где они применимы.
- [x] **S2.7.** Включить RLS на tenant business tables; создать owner/runtime roles, запретить runtime role ownership/`BYPASSRLS` и задавать transaction-local `app.network_id` только из server session.
- [x] **S2.8.** Использовать Drizzle schema как источник server-side database types; проверить соответствие schema и сгенерированных migrations.
- [x] **S2.9.** Подготовить безопасный migration workflow для локальной isolated PostgreSQL и единственного production Railway PostgreSQL service; migrations применяются прямым unpooled connection до Worker release.

### Критерии приёмки

- [x] Все business tables имеют обязательный `network_id`; soft delete и лишние таблицы отсутствуют.
- [x] Прямой browser client не может читать или изменять public tables.
- [x] Constraints отвергают отрицательные деньги, некорректные quantities, дубликаты balance/goal/feedback и cross-tenant references.
- [x] Чистая БД разворачивается полным набором migrations, а Drizzle-inferred types соответствуют schema source.

### Фиксация решений для следующих этапов

Схема и будущие API/UI должны сохранять следующие продуктовые решения: имена точек нормализуются
для поиска дублей (trim, схлопывание пробелов, без изменения отображаемого текста); disabled и
expired accounts сохраняют данные и не занимают активный лимит, а hard delete аккаунта удаляет все
его данные только после явного подтверждения; конкурентные price/goal/feedback/inventory mutations
проверяют `version` или блокировку баланса и возвращают конфликт, не перетирая ввод пользователя;
все mutations получают UUID idempotency key и повтор запроса не создаёт вторую операцию.

Месяц цели вычисляется в зафиксированной IANA timezone сети; новый месяц без цели показывает
`goal not set`, а zero goal удаляет текущую цель. Reset атомарен, выигрывает у stale mutation,
показывает пользователю список сбрасываемых/сохраняемых данных и использует pinned generator
version сети. Country только предлагает currency и timezone, ручной выбор не перезаписывается;
после завершения onboarding сеть и точки не редактируются в MVP. Для `pcs` разрешены только целые
количества, для `kg`/`l` — до трёх знаков; деньги — до двух знаков, без silent rounding. Zero price
допустим после отдельного предупреждения и не меняет исторические продажи.

Onboarding показывает review перед генерацией; при двух вкладках побеждает первый завершивший,
а вторая вкладка переходит в Overview. Невалидный или чужой `location` в URL безопасно откатывается
на All locations с предупреждением. Expiry во время активной сессии обрабатывается на следующем
запросе как `401` с очисткой кэша; реактивация при 15 активных аккаунтах блокируется и не выключает
другой аккаунт. Version conflicts в UI предлагают reload или explicit overwrite, а введённое
значение сохраняется до выбора пользователя.

При outage reads отдают последний успешный snapshot с timestamp и persistent banner, mutations
отключаются, формы сохраняют введённые значения. Demo-stale banner не сбрасывает данные
автоматически. Product analytics best-effort и не откатывает пользовательское действие.
Feedback хранится одной текущей строкой, переживает Reset, а удаление аккаунта удаляет его.
Backups, disaster recovery и per-account restore находятся за пределами MVP.

S2.1 завершён: миграции применены к единственному Railway PostgreSQL service, роль `brew_runtime`
подключена через cache-disabled Hyperdrive, а binding добавлен в `wrangler.jsonc`. Railway-native
backup schedules не являются частью MVP и не требуются для закрытия этапа.

---

## Этап 3. Реализовать администрирование аккаунтов, auth и session

**Цель:** обеспечить безопасный персональный вход без публичной регистрации и без передачи tenant scope из браузера.

**Зависимости:** этапы 1–2.

### Задачи

- [x] **S3.1.** Создать request-scoped Drizzle client через cache-disabled Hyperdrive binding и server-side Better Auth instance с PostgreSQL adapter.
- [x] **S3.2.** Реализовать `bun run admin:create-user -- --login <login>` с нормализацией, case-insensitive uniqueness, login длиной 3–64 из латинских букв, цифр, `.`, `_`, `-`, password длиной 12–128 и лимитом 15 активных demo accounts.
- [x] **S3.3.** В admin command создавать Better Auth credential user с login alias и внутренним техническим email, `app_users` и пустую сеть без точек/business data; выводить пароль один раз без записи в БД, файл, лог или shell history.
- [x] **S3.4.** Добавить защищённые admin commands сброса пароля, отключения аккаунта и удаления только явно указанного demo/e2e account.
- [x] **S3.5.** Реализовать `POST /auth/login`, `POST /auth/logout` и `GET /auth/me` с единым generic login error; использовать Better Auth username/password sign-in, отключить public signup/recovery endpoints и добавить server-side login rate limit.
- [x] **S3.6.** Хранить opaque Better Auth session token только в cookie `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`; продлевать и проверять database session server-side, отзывать её при logout/невалидном аккаунте и не использовать JWT access/refresh tokens.
- [x] **S3.7.** Проверять status и `expires_at`; обновлять `last_login_at`; не допускать вход отключённого или истёкшего аккаунта.
- [x] **S3.8.** Реализовать auth middleware, который получает `network_id` только из проверенного `app_users` и добавляет его ко всем business queries.
- [x] **S3.9.** Ограничить JSON body размером 256 KiB; для mutations требовать same-origin JSON и валидный `Origin`.
- [x] **S3.10.** Добавить request ID middleware, единый API envelope и безопасное преобразование validation/auth/internal errors.
- [x] **S3.11.** Добавить integration tests admin creation, login/logout, session renewal/expiry, status/expiry и базовой tenant isolation минимум между двумя аккаунтами.

### Критерии приёмки

- [x] Публичных signup, email confirmation, recovery и user-facing password change нет.
- [x] Login alias не позволяет определить существование аккаунта по тексту или форме ошибки.
- [x] Browser request не может задать или подменить `network_id`.
- [x] E2E accounts не входят в лимит 15 demo accounts.
- [x] Технический email нигде не показывается пользователю и не используется для писем.
- [x] Credentials, cookies, tokens и password hashes отсутствуют в application logs и client bundle.

---

## Этап 4. Реализовать onboarding и детерминированный демо-набор

**Цель:** одним идемпотентным действием превратить пустой аккаунт в персональную сеть с воспроизводимыми данными.

**Зависимости:** этапы 1–3.

### Задачи

- [ ] **S4.1.** Реализовать `PUT /onboarding/language` с English по умолчанию и fallback.
- [ ] **S4.2.** Реализовать server validation названия сети и owner name длиной 2–80, 1–5 точек (default 3) с уникальными названиями длиной 2–80, ISO country/currency и IANA timezone.
- [ ] **S4.3.** Создать versioned deterministic generator со стабильным seed сети и локальной даты.
- [ ] **S4.4.** Генерировать до 20 товаров, до 3 000 заказов за шесть месяцев и текущий день, 1–3 позиции с price/cost snapshots, inventory, movements и месячную цель.
- [ ] **S4.5.** Гарантировать в наборе сильную/слабую точку, утренние/дневные пики, top/bottom products, четыре menu groups, low/out-of-stock, sales drop и данные Today/Yesterday.
- [ ] **S4.6.** Реализовать атомарную database operation завершения onboarding: сеть, точки, демо-набор и `onboarding_completed_at` создаются один раз.
- [ ] **S4.7.** Реализовать `POST /onboarding/complete`; повтор одного и того же запроса возвращает согласованный результат без дубликатов.
- [ ] **S4.8.** Запретить доступ к `/app/*` и business API до успешного завершения onboarding.
- [ ] **S4.9.** Вычислять устаревание Today/Yesterday и возвращать признак для предложения Reset без автоматического изменения данных.
- [ ] **S4.10.** Реализовать атомарную и идемпотентную reset operation: заменить только demo data и сохранить account, owner/network preferences, locations, tour state и feedback.
- [ ] **S4.11.** Добавить unit/integration tests детерминированности, локальной даты, generator invariants, onboarding idempotency, rollback при ошибке и atomic Reset.

### Критерии приёмки

- [ ] Повторная генерация одной сети в один локальный день даёт одинаковый исходный набор.
- [ ] Ошибка на любом шаге не оставляет частично созданную сеть или demo data.
- [ ] Повторный onboarding не создаёт дубликаты.
- [ ] Reset не затрагивает данные другого tenant и сохраняет перечисленные preferences/feedback.
- [ ] После генерации фоновые и Cron-заказы не создаются.

---

## Этап 5. Реализовать read-only analytics API

**Цель:** дать всем аналитическим экранам согласованные server-side метрики из одной модели данных.

**Зависимости:** этап 4.

### Задачи

- [ ] **S5.1.** Создать общий resolver фильтров location/period, текущего и предыдущего окна в timezone сети.
- [ ] **S5.2.** Реализовать `GET /overview`: шесть KPI, comparison, trends, monthly goal, location comparison, top/bottom products, stock summary и alerts.
- [ ] **S5.3.** Реализовать `GET /locations`: карточки, метрики, active alerts, сортировку и явные best/weak labels.
- [ ] **S5.4.** Реализовать `GET /sales`: KPI, daily/comparison series, weekday/hour heatmap, peak hours и breakdown по locations/categories/products.
- [ ] **S5.5.** Добавить recent synthetic orders с позициями и cursor/page pagination; не добавлять order mutations.
- [ ] **S5.6.** Реализовать `GET /products`: категории, current price/cost, period metrics, revenue share, balances и menu matrix/recommendations.
- [ ] **S5.7.** Реализовать `GET /inventory`: balances, thresholds/statuses, recent movements, location/status filters и stock alerts.
- [ ] **S5.8.** Вычислять `LOW_STOCK`, `OUT_OF_STOCK` и `SALES_DROP` при запросе без persistent alert lifecycle.
- [ ] **S5.9.** Добавить explain/query checks для тяжёлых агрегатов и при необходимости уточнить индексы новой migration.
- [ ] **S5.10.** Добавить integration tests формул, фильтров, comparison, pagination, timezone boundaries, error envelope и read isolation между двумя tenants.

### Критерии приёмки

- [ ] Одинаковые фильтры дают согласованные KPI на всех endpoints.
- [ ] Historical metrics используют snapshots и не зависят от текущей цены товара.
- [ ] Нулевые знаменатели возвращаются как представимое `N/A`, а не `NaN`/`Infinity`.
- [ ] Все reads используют server-derived `network_id`; cross-tenant UUID возвращает безопасную ошибку.
- [ ] В API нет endpoints для CRUD/отмены/возврата заказов и других out-of-scope операций.

---

## Этап 6. Построить UI foundation, локализацию и общий shell

**Цель:** создать единое адаптивное основание для всех пользовательских потоков и состояний.

**Зависимости:** этапы 1, 3 и стабильные API contracts этапа 5.

### Задачи

- [ ] **S6.1.** Настроить TanStack Router для `/login`, `/first-run/language`, `/first-run/onboarding` и всех `/app/*` routes.
- [ ] **S6.2.** Реализовать root redirect и route guards по session/onboarding state, включая возврат на login после `401`.
- [ ] **S6.3.** Создать same-origin API client с envelope parsing, request ID в ошибке и очисткой TanStack Query cache при `401`.
- [ ] **S6.4.** Создать desktop shell с sidebar/top filters и mobile/tablet shell с compact header и drawer navigation.
- [ ] **S6.5.** Добавить alerts badge/dropdown, постоянный доступ к feedback и logout; не создавать отдельный Alerts route.
- [ ] **S6.6.** Реализовать глобальные location/period filters в URL query parameters с восстановлением после reload.
- [ ] **S6.7.** Настроить RU/EN dictionaries, English default/fallback, локализацию validation, states, dates, numbers и currency; пользовательские названия не переводить.
- [ ] **S6.8.** Собрать светлую визуальную систему на shadcn/ui: off-white/cream surfaces, coffee accent и различимые success/warning/critical/chart colors.
- [ ] **S6.9.** Создать переиспользуемые skeleton, error/retry, empty, progress/disabled, toast и form-error patterns без потери введённых значений.
- [ ] **S6.10.** Настроить code splitting routes и приоритет загрузки KPI перед тяжёлыми charts.
- [ ] **S6.11.** Добавить test, который падает на отсутствующем RU/EN translation key.

### Критерии приёмки

- [ ] Reload сохраняет location/period в URL, а неизвестные client routes корректно обрабатывает SPA fallback.
- [ ] Навигация работает без page-level horizontal scroll на 320 px, tablet и desktop.
- [ ] Focus видим, status не передаётся только цветом, dialogs/navigation используют semantic primitives.
- [ ] Во всех routes есть безопасное поведение при loading, empty, error и unauthenticated state.

---

## Этап 7. Реализовать login, first run и guided tour

**Цель:** довести основной путь от выданных credentials до персонального Overview.

**Зависимости:** этапы 4 и 6.

### Задачи

- [ ] **S7.1.** Создать login form для alias/password с generic error, progress и блокировкой повторной отправки.
- [ ] **S7.2.** Создать обязательный language step с English preselected и сохранением выбора.
- [ ] **S7.3.** Создать onboarding form на TanStack Form: сеть, owner, количество и уникальные названия точек, country, currency и timezone.
- [ ] **S7.4.** Согласовать client validation с shared Zod; при server error сохранять введённые значения.
- [ ] **S7.5.** Показать progress генерации, запретить повторную отправку и перенаправить на Overview только после атомарного успеха.
- [ ] **S7.6.** После onboarding предложить пропускаемый tour из трёх шагов: Overview KPI/filters, locations/products и inventory/feedback.
- [ ] **S7.7.** Сохранить completed/skipped state через API и разрешить повторный запуск из Settings.
- [ ] **S7.8.** Добавить component tests login/language/onboarding forms, validation/errors и tour state.
- [ ] **S7.9.** Добавить Playwright journey `Login → Language → Onboarding → Overview → Tour`.

### Критерии приёмки

- [ ] Неавторизованный пользователь не попадает в `/app/*`, а пользователь без onboarding не может его обойти прямым URL.
- [ ] Onboarding принимает ровно 1–5 уникально названных точек и корректные ISO/IANA значения.
- [ ] Повторный submit не создаёт дубликаты; ошибка не очищает форму.
- [ ] Tour можно завершить, пропустить и позднее запустить снова.

---

## Этап 8. Реализовать Overview и Locations

**Цель:** дать владельцу за несколько минут понять состояние сети и различия между точками.

**Зависимости:** этапы 5–7.

### Задачи

- [ ] **S8.1.** Реализовать Overview KPI: Revenue, Gross Profit, Orders, Average Check, Gross Margin и Active Alerts.
- [ ] **S8.2.** Для финансовых KPI показать absolute value и comparison; `N/A` отображать явно.
- [ ] **S8.3.** Добавить Revenue/Gross Profit trend, comparison series и responsive chart containers.
- [ ] **S8.4.** Добавить monthly goal progress, location comparison, top/bottom products, stock summary и последние active alerts.
- [ ] **S8.5.** Показать ненавязчивое предложение Reset, когда Today/Yesterday data устарели; выполнять reset только после подтверждения.
- [ ] **S8.6.** Реализовать Locations cards/table с шестью метриками, active alerts и сортировкой.
- [ ] **S8.7.** Обозначить лучшую и слабую точку текстом, иконкой и цветом; не создавать detail page или CRUD.
- [ ] **S8.8.** Добавить mobile card/column-priority representations, loading/empty/error states и component tests.

### Критерии приёмки

- [ ] Смена глобального фильтра согласованно обновляет все виджеты и comparison.
- [ ] Overview и Locations показывают одну и ту же финансовую модель и формат валюты.
- [ ] KPI читаемы в 1–2 колонки на mobile, charts не создают горизонтальный скролл страницы.
- [ ] Playwright проверяет смену location/period и согласованное обновление аналитики.

---

## Этап 9. Реализовать Sales и Products

**Цель:** показать источники продаж и прибыльности, сохранив историю неизменяемой.

**Зависимости:** этапы 5–8.

### Задачи

- [ ] **S9.1.** Реализовать Sales KPI, daily/comparison trends, weekday/hour heatmap и peak hours.
- [ ] **S9.2.** Добавить breakdown по точкам, категориям и товарам.
- [ ] **S9.3.** Добавить recent orders и items с pagination и адаптивным table/card отображением.
- [ ] **S9.4.** Реализовать Products list по категориям с current price/cost, units sold, Revenue, Gross Profit, Gross Margin, revenue share и balances.
- [ ] **S9.5.** Визуализировать menu engineering matrix `Stars`, `Workhorses`, `Puzzles`, `Dogs` и rule-based recommendations.
- [ ] **S9.6.** Реализовать `PATCH /products/:productId/price`: non-negative current price, tenant ownership и отсутствие изменений historical order items.
- [ ] **S9.7.** Добавить price dialog с progress, disabled duplicate submit, toast и сохранением значения при ошибке.
- [ ] **S9.8.** После изменения цены точечно инвалидировать Products current margin/matrix и связанные актуальные reads, не переписывая historical sales.
- [ ] **S9.9.** Записать событие `product_price_changed` с безопасной schema metadata.
- [ ] **S9.10.** Добавить integration/component tests и Playwright journey изменения цены.

### Критерии приёмки

- [ ] Sales остаётся полностью read-only; order CRUD, cancel и refunds отсутствуют.
- [ ] Изменение цены сразу меняет current unit margin и при необходимости menu group/recommendation.
- [ ] Revenue и Gross Profit исторических продаж до и после изменения цены совпадают.
- [ ] Heatmap, matrix и таблицы доступны и адаптивны на desktop/mobile.

---

## Этап 10. Реализовать Inventory, movements и вычисляемые alerts

**Цель:** дать безопасный способ попробовать приход/списание и сразу увидеть связанный результат.

**Зависимости:** этапы 4–6 и 8.

### Задачи

- [ ] **S10.1.** Реализовать Inventory list с единицами, balances по точкам, thresholds, статусами, location/status filters и recent movements.
- [ ] **S10.2.** Создать атомарную database function для inventory movement и balance update.
- [ ] **S10.3.** Реализовать `POST /inventory/movements` только для `receipt` и `writeoff` с положительным quantity.
- [ ] **S10.4.** Для writeoff блокировать quantity больше текущего balance; проверить concurrency, чтобы остаток не становился отрицательным.
- [ ] **S10.5.** Создать Receipt/Write off forms со shared validation, progress, duplicate-submit lock, toast и сохранением ввода при ошибке.
- [ ] **S10.6.** После success точечно обновить Inventory, Overview и alerts badge/dropdown.
- [ ] **S10.7.** Удалять stock alert из ответа сразу после устранения condition; не хранить persistent alert state.
- [ ] **S10.8.** Записать `inventory_movement_created`; не добавлять edit/delete movement.
- [ ] **S10.9.** Добавить integration tests receipt/writeoff, threshold transitions, negative-stock rejection, tenant isolation и atomic rollback.
- [ ] **S10.10.** Добавить component tests forms/statuses и Playwright journey изменения balance/alert.

### Критерии приёмки

- [ ] `In stock`, `Low stock` и `Out of stock` точно следуют формулам PRD.
- [ ] Успешный movement виден на Inventory и Overview без полного reload.
- [ ] Параллельные списания не создают отрицательный balance.
- [ ] Movements нельзя редактировать или удалять; восстановление возможно только через Reset.

---

## Этап 11. Реализовать Settings, goal, feedback, events и reset flow

**Цель:** завершить разрешённые действия, сбор сигнала спроса и управление персональным демо.

**Зависимости:** этапы 4, 6 и 8–10.

### Задачи

- [ ] **S11.1.** Создать Settings с read-only network/owner, language, monthly goal, restart tour, feedback, reset и logout; currency/timezone оставить read-only.
- [ ] **S11.2.** Реализовать `PUT /settings/revenue-goal` как tenant-scoped upsert текущего месяца с non-negative amount.
- [ ] **S11.3.** После изменения цели обновить Overview progress и записать `revenue_goal_changed`.
- [ ] **S11.4.** Реализовать `PUT /settings/language` и мгновенно переключать полный UI без потери состояния.
- [ ] **S11.5.** Реализовать `PUT /settings/tour` и связать его с повторным запуском tour.
- [ ] **S11.6.** Реализовать `GET/PUT /feedback` как один tenant-scoped upsert: rating 1–5, comment до 2 000 и обязательный `desired_features` до 2 000 символов.
- [ ] **S11.7.** Добавить постоянную feedback-кнопку и форму в Settings; повторное открытие показывает сохранённые значения.
- [ ] **S11.8.** Показать dismissible feedback prompt после трёх разных section views или двух разрешённых mutations, не блокируя работу.
- [ ] **S11.9.** Реализовать `POST /events` только для whitelist; не писать passwords, cookies, arbitrary form text или feedback contents.
- [ ] **S11.10.** Отправлять `login_succeeded`, `onboarding_completed`, `section_viewed`, `filter_changed`, все mutation events, `demo_reset` и `feedback_submitted` без дубликатов от React Strict Mode/retries.
- [ ] **S11.11.** Реализовать `POST /demo/reset` и Reset confirmation/progress/duplicate-submit lock через атомарную operation этапа 4; после success полностью инвалидировать tenant analytics cache.
- [ ] **S11.12.** Проверить, что Reset сохраняет account/network preferences, locations, tour state и feedback и фиксирует `demo_reset`.
- [ ] **S11.13.** Добавить integration/component tests goal, language, tour, feedback, event whitelist/sanitization и atomic Reset.
- [ ] **S11.14.** Добавить Playwright journeys goal, feedback persistence и Reset preservation.

### Критерии приёмки

- [ ] Все Settings mutations tenant-scoped, idempotent там, где это требуется, и имеют согласованные состояния UI.
- [ ] Feedback переживает Reset и доступен администратору только через Railway database view/SQL client; admin UI отсутствует.
- [ ] Текст feedback и произвольные form values не появляются в events или application logs.
- [ ] После Reset все аналитические экраны показывают восстановленный детерминированный набор текущей сети.

---

## Этап 12. Провести системное тестирование и hardening

**Цель:** подтвердить критические свойства продукта, которые нельзя доказать отдельными feature tests.

**Зависимости:** этапы 0–11.

### Задачи

- [ ] **S12.1.** Свести unit suite: формулы, periods/timezones, matrix, stock/alerts, schemas, generator и event whitelist.
- [ ] **S12.2.** Свести integration suite: admin creation, auth/session expiry, onboarding, mutations, feedback, reset, envelope и два tenants.
- [ ] **S12.3.** Добавить safety guard runner: destructive test/cleanup немедленно прекращается, если account не `e2e`, и никогда не перечисляет demo accounts.
- [ ] **S12.4.** Свести component suite: first run, filters, все dialogs/forms, loading/empty/error states, mobile navigation и accessible errors.
- [ ] **S12.5.** Завершить восемь обязательных Playwright journeys из PRD на desktop и mobile viewport.
- [ ] **S12.6.** Проверить keyboard navigation, labels/errors, focus, dialog focus trap, WCAG AA contrast основного текста/controls и reduced motion.
- [ ] **S12.7.** Проверить responsive ranges 320–767, 768–1279 и 1280+ px; устранить page-level horizontal scroll и нечитаемые charts/tables.
- [ ] **S12.8.** Измерить performance budgets: первый полезный экран до 3 секунд, filter reaction до 1 секунды после API response, mutation до 2 секунд без network failure.
- [ ] **S12.9.** Проверить route code splitting, KPI-first loading, TanStack Query cache/invalidation и pagination recent orders.
- [ ] **S12.10.** Добавить security headers: CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy` и frame protection; проверить HTTPS и Origin enforcement.
- [ ] **S12.11.** Провести security review tenant scope, body limits, generic auth errors, secret exposure и отсутствия credentials/feedback в логах.
- [ ] **S12.12.** Настроить Cloudflare Workers Observability: structured JSON logs с requestId, route, method, status, durationMs и safe account identifiers.
- [ ] **S12.13.** Добавить наблюдение за 5xx, login failures, onboarding/reset failures и API latency; stack оставлять только в server logs.
- [ ] **S12.14.** Показывать пользователю localized safe error и request ID для обращения за помощью.
- [ ] **S12.15.** Выполнить `bun audit`, разобрать findings и не ослаблять security controls ради прохождения тестов.

### Критерии приёмки

- [ ] Все root validation commands проходят; non-zero exit, timeout, unhandled rejection и console/runtime error считаются провалом.
- [ ] Два аккаунта не читают и не изменяют данные друг друга ни через UI, ни через подменённые API requests.
- [ ] Все восемь E2E journeys проходят на поддерживаемых desktop/mobile состояниях.
- [ ] Performance budgets либо подтверждены измерениями, либо явно зафиксирован блокирующий gap до release.
- [ ] В логах и telemetry нет secrets, tokens, cookies, feedback contents и произвольных form texts.

---

## Этап 13. Развернуть Production и провести Demo MVP acceptance

**Цель:** получить единственное безопасное production-окружение, готовое к выдаче персональных доступов.

**Зависимости:** этап 12.

### Задачи

- [ ] **S13.1.** Зафиксировать Cloudflare compatibility date и production config для Worker, assets, SPA fallback, `/api/*` и Observability; не добавлять Cron, staging и preview.
- [ ] **S13.2.** Проверить существующие Railway Hobby PostgreSQL service и cache-disabled Hyperdrive configuration; создать один `*.workers.dev` deployment.
- [ ] **S13.3.** Проверить существующий `HYPERDRIVE` binding, сохранить `BETTER_AUTH_SECRET` в Cloudflare Secrets и non-secret base URL в Worker environment; повторно проверить отсутствие database/auth secrets в bundle и git.
- [ ] **S13.4.** Задокументировать порядок релиза: вручную применить совместимые migrations, затем развернуть Worker.
- [ ] **S13.5.** Выполнить release gate на чистом worktree: lint, typecheck, unit tests, production build и `bun audit`.
- [ ] **S13.6.** Выполнить smoke checks `/api/v1/health`, login, Overview и feedback на отдельном e2e account.
- [ ] **S13.7.** Пройти полный чек-лист раздела 22 `PRD.md`, включая RU/EN, filters/comparison, три группы mutations, reset, tenancy и responsive flow.
- [ ] **S13.8.** Проверить UI/API на отсутствие out-of-scope функций и текстов, создающих впечатление реальных данных.
- [ ] **S13.9.** Проверить admin workflow создания до 15 demo accounts и однократной безопасной передачи credentials.
- [ ] **S13.10.** После финального E2E удалить только явно выбранный e2e account и его tenant data защищённой admin command.
- [ ] **S13.11.** Подготовить операционный чек-лист выдачи приглашений и проверки цели: минимум три явных запроса на обсуждение или пилот из первых 15 владельцев.

### Критерии приёмки

- [ ] Production работает на одном Worker, одном Railway PostgreSQL service и одной Hyperdrive configuration; staging/preview/remote test database отсутствуют.
- [ ] Миграции применены до совместимой версии Worker, health и критические smoke checks зелёные.
- [ ] Можно безопасно создать и выдать 15 независимых demo accounts без хранения открытых паролей.
- [ ] Все критерии готовности Demo MVP из PRD подтверждены фактическим UI/API/E2E сигналом.

---

## Матрица покрытия PRD

| Раздел PRD                                        | Этапы                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| 1–3. Назначение, сценарий и границы MVP           | Сквозной критерий, все этапы, финальный out-of-scope audit S13.8 |
| 4. Технологическая основа                         | Этап 0                                                           |
| 5–6. Информационная архитектура и общий интерфейс | Этапы 6–11                                                       |
| 7. Авторизация и аккаунты                         | Этап 3                                                           |
| 8. Первый вход и onboarding                       | Этапы 4 и 7                                                      |
| 9. Демо-данные и Reset                            | Этапы 4 и 11                                                     |
| 10. Метрики                                       | Этапы 1 и 5                                                      |
| 11. Функциональные разделы                        | Этапы 8–11                                                       |
| 12. Feedback и product events                     | Этап 11                                                          |
| 13. Railway PostgreSQL schema                     | Этап 2                                                           |
| 14–15. Hono API, validation и atomicity           | Этапы 1, 3–5 и 9–11                                              |
| 16. Локализация и visual system                   | Этап 6                                                           |
| 17. Responsive и accessibility                    | Этапы 6–12                                                       |
| 18. Производительность и безопасность             | Этап 12                                                          |
| 19. Наблюдаемость                                 | Этап 12                                                          |
| 20. Тестирование                                  | Тесты каждого этапа и этап 12                                    |
| 21. Production deployment                         | Этап 13                                                          |
| 22. Критерии готовности                           | Этап 13                                                          |
| 23. Definition of Done                            | Обязателен для каждой задачи                                     |
