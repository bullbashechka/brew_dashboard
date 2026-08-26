# Brew Dashboard — Product Requirements Document

**Версия:** Demo MVP 0.2
**Дата:** 2026-08-23
**Статус:** готово к разработке
**Язык документа:** русский; программные идентификаторы, маршруты, API и сущности БД — английские.

## 1. Назначение продукта

Brew Dashboard — закрытое адаптивное веб-демо для владельца небольшой сети кофеен из 1–5 точек. Продукт показывает, как в одном интерфейсе можно контролировать выручку, прибыльность, точки, ассортимент и остатки.

Первая версия предназначена не для реальной эксплуатации кофейни, а для проверки спроса. Владелец получает персональный логин и пароль, настраивает демо под название своей сети, изучает синтетические показатели, пробует несколько безопасных действий и оставляет обратную связь.

Реальные POS-интеграции, импорт продаж и полноценный операционный учёт появляются только после подтверждения интереса к продукту.

### 1.1. Целевая аудитория

- владелец небольшой сети кофеен;
- 1–5 точек в одной сети;
- один пользователь с полным доступом к персональному демо;
- русскоязычные владельцы, кофейни Казахстана и англоязычная аудитория;
- до 15 одновременно выданных демо-аккаунтов.

### 1.2. Главная пользовательская ценность

За несколько минут владелец должен понять:

- сколько сеть заработала и как результат изменился;
- какая точка работает лучше или хуже остальных;
- какие товары дают продажи и прибыль;
- какие ингредиенты заканчиваются;
- какие проблемы требуют внимания;
- хотел бы он видеть собственные реальные данные в таком интерфейсе.

### 1.3. Цель проверки спроса

Первые 15 персональных приглашений считаются успешной проверкой идеи, если минимум три владельца явно запрашивают дальнейшее обсуждение или пилот через форму обратной связи либо ответ на рассылку.

Дополнительные сигналы:

- получатель завершил onboarding;
- открыл несколько аналитических разделов;
- применил фильтры;
- выполнил хотя бы одно разрешённое действие;
- отправил содержательный отзыв.

## 2. Пользовательский сценарий

Основной путь:

1. Владелец получает от администратора персональный логин и пароль.
2. Входит в приложение и выбирает English или Русский.
3. Вводит имя владельца, название сети и данные 1–5 точек.
4. Приложение создаёт персональный синтетический демо-набор.
5. Пользователь при желании проходит короткий пропускаемый tour по основным разделам.
6. Изучает Overview, сравнение точек, продажи, товары и остатки.
7. Пробует изменить цену, пополнить или списать остаток и изменить месячный план.
8. Видит, как связанные показатели и предупреждения обновляются.
9. Оставляет оценку и обратную связь.
10. При необходимости восстанавливает исходный набор через Reset demo data.

Изменения одного пользователя никогда не видны другим аккаунтам.

## 3. Границы Demo MVP

### 3.1. Входит в первую версию

- персональные аккаунты, создаваемые администратором;
- Better Auth без публичной регистрации;
- вход по выданному login alias и паролю;
- English и Русский, English по умолчанию;
- onboarding сети из 1–5 точек;
- короткий пропускаемый guided tour;
- Overview, Locations, Sales, Products, Inventory и Settings;
- встроенные stock/sales alerts без отдельного экрана;
- синтетические данные за шесть месяцев;
- фильтры точки и периода;
- автоматическое сравнение с предыдущим аналогичным периодом;
- изменение текущей цены товара;
- приход и списание остатка;
- изменение месячного плана;
- Reset demo data;
- встроенная форма обратной связи;
- минимальная аналитика использования демо;
- responsive desktop и mobile интерфейс;
- один production Worker и один Railway PostgreSQL service.

### 3.2. Не входит в первую версию

- реальная эксплуатация кофейни;
- POS и другие внешние интеграции;
- CSV/Excel import и export;
- публичная регистрация;
- подтверждение email, password reset и смена пароля пользователем;
- несколько пользователей, роли, приглашения и admin UI;
- полноценный CRUD заказов и позиций;
- возвраты, reversal и сложный финансовый ledger;
- сотрудники и смены;
- отзывы клиентов и тематическая классификация;
- отдельные разделы Waste и Alerts;
- audit log, History, Trash, soft delete и restore;
- Cron и фоновые задачи;
- drag-and-drop и настройка состава Overview;
- PDF и печатные отчёты;
- расширенная налоговая модель;
- внешние уведомления;
- AI, прогнозирование и автоматические рекомендации;
- казахская локализация;
- landing page, платежи и подписки;
- staging, preview deployments и отдельная remote test database;
- production SLA, point-in-time recovery, off-site backup automation и полноценная
  observability-платформа.

## 4. Технологическая основа

Проект использует структуру и инженерные соглашения шаблона `di-sukharev/vibe`, ветка `master`, но адаптируется под Cloudflare Workers и Railway PostgreSQL.

### 4.1. Сохраняемые части шаблона

- Bun workspace и monorepo;
- `webapp`: React, TypeScript, Vite, TanStack Router, TanStack Query, TanStack Form, Tailwind CSS, shadcn/ui, Recharts и Playwright;
- `backend`: Hono и Zod/OpenAPI, адаптированные под Cloudflare Workers;
- `packages/contracts`: общие Zod-схемы и TypeScript-типы;
- lint, typecheck, unit, integration и E2E-команды.

### 4.2. Удаляемые или заменяемые части шаблона

- `website`/Astro и mobile не входят в active workspace;
- Prisma и старая standalone PostgreSQL-реализация заменяются Railway PostgreSQL, Drizzle schema и versioned SQL migrations;
- исходная JWT/auth-модель заменяется database-backed sessions Better Auth;
- email/reset, роли, media storage и background jobs удаляются;
- Terraform и DigitalOcean/Yandex runbooks заменяются конфигурацией Cloudflare Worker;
- неиспользуемые зависимости и команды удаляются из workspace и lockfile.

### 4.3. Целевая архитектура

- один Cloudflare Worker обслуживает Hono API под `/api/*` и статическую React/Vite SPA;
- неизвестные статические маршруты получают SPA fallback на `index.html`;
- React обращается только к Hono API того же origin;
- браузер не обращается к PostgreSQL напрямую;
- Hono подключается к Railway PostgreSQL через cache-disabled Cloudflare Hyperdrive binding и Drizzle;
- Railway `DATABASE_PUBLIC_URL` используется только для создания Hyperdrive configuration, migrations и защищённых admin commands и никогда не попадает в Worker или Vite bundle;
- Better Auth secret хранится только в Cloudflare Secrets и никогда не попадает в Vite bundle;
- Hono проверяет database-backed Better Auth session и получает `network_id` только из server-side профиля пользователя;
- каждый бизнес-запрос явно ограничивается текущим `network_id`;
- runtime database role не владеет tenant tables и не имеет `BYPASSRLS`; tenant context задаётся через transaction-local `app.network_id`;
- Drizzle schema является источником database types, а сгенерированные versioned SQL migrations применяются отдельно;
- Zod-схемы в `packages/contracts` являются источником API-контрактов;
- время хранится в UTC и показывается в IANA timezone сети.

## 5. Информационная архитектура

| Маршрут                 | Экран                                | Доступ                         |
| ----------------------- | ------------------------------------ | ------------------------------ |
| `/login`                | Вход                                 | Без сессии                     |
| `/first-run/language`   | Выбор языка                          | Сессия, первый вход            |
| `/first-run/onboarding` | Настройка сети                       | Сессия, onboarding не завершён |
| `/app/overview`         | Главный dashboard                    | Сессия                         |
| `/app/locations`        | Карточки и сравнение точек           | Сессия                         |
| `/app/sales`            | Аналитика продаж                     | Сессия                         |
| `/app/products`         | Товары и menu engineering            | Сессия                         |
| `/app/inventory`        | Остатки, приходы и списания          | Сессия                         |
| `/app/settings`         | Язык, цель, feedback, reset и logout | Сессия                         |

Корневой маршрут перенаправляет пользователя на `/login`, `/first-run/*` или `/app/overview` по состоянию Better Auth session и onboarding.

Alerts открываются из badge/dropdown в общей шапке и показываются на Overview. Feedback открывается из постоянной кнопки и из Settings.

## 6. Общий интерфейс

### 6.1. Навигация

- Desktop: постоянная боковая панель и верхняя панель фильтров.
- Tablet/mobile: компактная верхняя панель и drawer navigation.
- В шапке показывается badge текущих активных предупреждений.
- Feedback и logout доступны из любого раздела.
- Основные действия не требуют горизонтального скролла страницы.

### 6.2. Глобальные фильтры

На аналитических экранах доступны:

- location: `All locations` или одна точка;
- period: `Today`, `7 days`, `30 days`, `6 months`.

Фильтры сохраняются в URL query parameters и переживают обновление страницы. Сравнение с непосредственно предшествующим периодом той же длительности включено автоматически и не имеет отдельного переключателя.

Для `Today` используется сравнение со вчерашним днём до того же локального времени. Если исходное значение равно нулю, процентное изменение отображается как `N/A`.

### 6.3. Общие состояния

Каждый основной экран имеет:

- skeleton при первой загрузке;
- error state с retry;
- empty state для отсутствующих данных;
- progress и блокировку повторной отправки для разрешённых actions;
- toast после успешного действия;
- понятную ошибку с сохранением введённых значений.

### 6.4. Guided tour

После onboarding один раз предлагается пропускаемый tour из трёх шагов:

1. KPI и глобальные фильтры Overview.
2. Сравнение точек и Products matrix.
3. Inventory alerts и форма feedback.

Состояние завершения или пропуска сохраняется для аккаунта. Tour можно запустить повторно из Settings.

## 7. Авторизация и аккаунты

### 7.1. Создание аккаунта

Публичной регистрации нет. Администратор запускает локальную защищённую команду против production Railway PostgreSQL через server-only connection string:

```text
bun run admin:create-user -- --login <login>
```

Команда:

1. нормализует login и проверяет case-insensitive uniqueness;
2. проверяет лимит не более 15 активных demo accounts;
3. генерирует пароль либо принимает его интерактивно;
4. создаёт Better Auth credential user с login alias и внутренним техническим email;
5. создаёт `app_users` и пустую сеть с незавершённым onboarding;
6. не создаёт точки и бизнес-данные;
7. выводит login и пароль один раз;
8. не пишет открытый пароль в БД, логи, файлы или shell history.

Требования к login: 3–64 символа, латинские буквы, цифры, `.`, `_`, `-`; сравнение без учёта регистра. Пароль: 12–128 символов.

Отдельные административные команды позволяют сбросить пароль, отключить аккаунт и удалить только явно выбранный demo/e2e account.

### 7.2. Better Auth

- Пароль в открытом виде не хранится; password hash находится только в credential account Better Auth.
- `app_users` не содержит password fields.
- Технический email не показывается пользователю и не используется для писем.
- Hono принимает `login` и `password` и выполняет Better Auth username/password sign-in.
- Ошибка входа всегда едина и не раскрывает существование login.
- Login endpoint имеет server-side rate limit и не полагается на browser state.
- Публичные signup, email confirmation, recovery и user-facing password change отсутствуют.
- Ненужные Better Auth routes отключены; браузеру доступен только согласованный Hono auth API.

### 7.3. Сессия

- Better Auth хранит opaque session token только в cookie `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`.
- Сессия хранится в PostgreSQL, продлевается и проверяется server-side; JWT access/refresh tokens не используются.
- Logout отзывает текущую database session и очищает cookie; reset password/disable account отзывает все сессии пользователя.
- Mutation-запросы принимаются только как same-origin JSON и проверяют `Origin`.
- `401` очищает TanStack Query cache и перенаправляет на `/login`.
- Истёкший `app_users.expires_at` блокирует вход независимо от состояния Better Auth user/session.

### 7.4. Tenancy

- один Better Auth user связан ровно с одной сетью;
- один аккаунт имеет доступ только к своей сети;
- `network_id` не принимается из browser request body;
- Hono получает tenant scope из проверенного `app_users`;
- E2E-аккаунты помечаются `account_kind = 'e2e'` и не учитываются в лимите 15 demo accounts.

## 8. Первый вход и onboarding

Последовательность:

`Login → Language → Onboarding → Demo generation → Overview → Optional tour`.

### 8.1. Выбор языка

- варианты: English и Русский;
- English выбран по умолчанию и является fallback;
- выбор обязателен и сохраняется;
- язык можно позднее изменить в Settings.

### 8.2. Поля onboarding

- название сети: 2–80 символов;
- имя владельца: 2–80 символов;
- количество точек: 1–5, default 3;
- название каждой точки: 2–80 символов и уникально внутри сети;
- страна: ISO 3166-1 alpha-2;
- валюта: ISO 4217;
- timezone: IANA timezone.

Для страны клиент предлагает базовые значения валюты и timezone без дополнительного
справочника: `KZ → KZT / Asia/Almaty`, `RU → RUB / Europe/Moscow`,
`US → USD / America/New_York`, `GB → GBP / Europe/London`. Предложение заполняет
только пустые или ранее автоматически заполненные поля; ручной ввод не перезаписывается.
При неизвестной стране очищаются только ранее автоматически предложенные значения.

### 8.3. Завершение onboarding

- клиентская и серверная Zod-валидация согласованы;
- сеть, точки и демо-набор создаются одной идемпотентной database operation;
- повторный запрос не создаёт дубликаты;
- при ошибке значения формы сохраняются;
- `onboarding_completed_at` и completed idempotency marker записываются последними;
- доступ к `/app/*` и business API до успешного завершения закрыт.

## 9. Демо-данные

### 9.1. Состав набора

Для каждой сети создаются:

- 1–5 точек из onboarding;
- до 20 товаров в нескольких категориях;
- до 3 000 заказов за предыдущие шесть месяцев и текущий день;
- 1–3 позиции в заказе;
- snapshot цены и себестоимости в каждой позиции;
- остатки и thresholds по точкам;
- исходные inventory movements;
- месячная цель;
- намеренно сильная и слабая точка;
- утренние и дневные пики;
- top/bottom products и все четыре группы menu engineering;
- low-stock, out-of-stock и sales-drop conditions;
- обязательные данные для Today и Yesterday.

Если в сети только одна точка, она считается нейтральной: демо не присваивает ей labels `best` или
`weak`. Сильная и слабая точки вычисляются и показываются только для сетей с двумя и более точками.

Данные синтетические и не заявляются как данные реальной кофейни.

### 9.2. Детерминированность

- generator имеет version и стабильный seed для сети и локальной даты;
- `demo_generations.created_at` — неизменяемый UTC anchor конкретной локальной даты;
- `demo_data_revision` равен `0` до onboarding, `1` после первой генерации и увеличивается на каждый новый Reset;
- повторный Reset в один локальный день создаёт одинаковый исходный набор;
- после генерации новые заказы автоматически не добавляются;
- когда Today/Yesterday устаревают, Overview предлагает выполнить Reset, но не меняет данные без подтверждения;
- stale-набор остаётся доступным для просмотра и изменений; mutation из старой вкладки с устаревшей
  `expectedDemoDataRevision` получает `409 CONFLICT` без потери введённого значения.

### 9.3. Разрешённые изменения

Пользователь может:

1. изменить только текущую selling price товара;
2. создать inventory movement типа `receipt` или `writeoff`;
3. изменить месячный revenue goal.

Правила:

- цена и цель не могут быть отрицательными;
- изменение текущей цены обновляет current unit margin и menu recommendation, но не переписывает исторические order items;
- receipt увеличивает остаток;
- writeoff вводится положительным количеством и не может превышать текущий остаток;
- inventory movements не редактируются и не удаляются, но Reset восстанавливает весь набор;
- изменения сохраняются между сессиями и влияют только на текущую сеть.

Все price, inventory movement и revenue-goal mutations передают `expectedDemoDataRevision`;
Reset выигрывает у stale mutation и требует повторного подтверждения актуального значения.

### 9.4. Reset demo data

- Reset находится в Settings и требует подтверждения;
- удаляются и заново создаются products, categories, orders, order items, inventory balances/movements и revenue goal;
- сохраняются Better Auth user/session-independent account data, login, owner name, network name, country, currency, timezone, language, locations, tour state и feedback;
- новые данные адаптируются к текущим названиям и количеству точек;
- операция атомарна и идемпотентна;
- повторная отправка блокируется;
- успешный Reset фиксируется как product event.

## 10. Метрики

Демо использует компактную понятную финансовую модель без refunds, discounts и tax breakdown.

| Показатель          | Формула                                                      |
| ------------------- | ------------------------------------------------------------ |
| Revenue             | `Σ(quantity × unit_price_at_sale)` для completed orders      |
| COGS                | `Σ(quantity × unit_cost_at_sale)` для completed orders       |
| Gross profit        | `revenue - COGS`                                             |
| Gross margin        | `gross_profit / revenue × 100%`                              |
| Orders              | количество completed orders                                  |
| Average check       | `revenue / orders`                                           |
| Current unit margin | `(current_price - current_unit_cost) / current_price × 100%` |
| Goal completion     | `current_month_revenue / monthly_goal × 100%`                |

Правила:

- cancelled orders исключаются из показателей;
- деньги хранятся как `numeric`, не `float`;
- исторические order items хранят snapshots цены и себестоимости;
- группировка по календарным дням и часам использует timezone сети;
- денежный формат следует выбранной ISO currency;
- деление на ноль отображается как `N/A`;
- сервер является источником формул для всех экранов.

## 11. Функциональные требования по разделам

### 11.1. Overview

Обязательные KPI:

- Revenue;
- Gross Profit;
- Orders;
- Average Check;
- Gross Margin;
- Active Alerts.

Обязательные виджеты:

- динамика Revenue и Gross Profit;
- progress месячной цели;
- сравнение точек;
- top/bottom products;
- low/out-of-stock summary;
- последние активные alerts.

Каждый финансовый KPI показывает абсолютное значение и изменение к предыдущему периоду.

### 11.2. Locations

Экран содержит карточки всех точек и единое сравнение по:

- Revenue;
- Gross Profit;
- Orders;
- Average Check;
- Gross Margin;
- Active Alerts.

Лучшая и слабая точка обозначаются текстом, иконкой и цветом. Доступна сортировка по показателям. Отдельной detail page и CRUD точек после onboarding нет.

### 11.3. Sales

Экран read-only и содержит:

- Revenue, COGS, Gross Profit, Gross Margin, Orders и Average Check;
- динамику по дням;
- автоматическое comparison series;
- heatmap дней недели и часов;
- peak hours;
- breakdown по точкам, категориям и товарам;
- последние синтетические заказы и позиции с pagination.

Создавать, редактировать, удалять, отменять или возвращать заказы нельзя.

### 11.4. Products

Экран содержит:

- категории и товары;
- current selling price и current unit cost;
- units sold, Revenue, Gross Profit и Gross Margin за период;
- revenue share;
- текущий остаток по точкам;
- изменение только current selling price.

Menu engineering matrix использует проданные единицы за выбранный период и текущий unit contribution (`current_price - current_unit_cost`) относительно медиан активных товаров. Поэтому изменение current price может сразу изменить категорию и рекомендацию товара, не переписывая исторические продажи:

- `Stars` — высокая популярность и прибыльность;
- `Workhorses` — высокая популярность, низкая прибыльность;
- `Puzzles` — низкая популярность, высокая прибыльность;
- `Dogs` — низкая популярность и прибыльность.

К каждой группе показывается короткая rule-based рекомендация. AI не используется.

### 11.5. Inventory

Экран содержит:

- позиции и единицы измерения;
- остатки по точкам;
- minimum threshold;
- `In stock`, `Low stock`, `Out of stock`;
- последние movements;
- фильтры точки и статуса;
- формы `Receipt` и `Write off`.

Статусы:

- `In stock`: `on_hand > min_threshold`;
- `Low stock`: `0 < on_hand <= min_threshold`;
- `Out of stock`: `on_hand = 0`.

Успешное движение немедленно обновляет Inventory, Overview и alerts.

### 11.6. Alerts

Alerts не имеют отдельного экрана и persistent lifecycle. Они вычисляются при запросе Overview/Inventory и после связанных действий.

Типы:

- `LOW_STOCK`;
- `OUT_OF_STOCK`;
- `SALES_DROP`.

Low/out-of-stock следуют Inventory thresholds. Sales drop сравнивает выбранную слабую точку с её предыдущим аналогичным периодом и создаётся демо-генератором как воспроизводимое условие. После устранения stock condition соответствующий alert исчезает.

### 11.7. Settings

Раздел содержит:

- текущую сеть и owner name в read-only виде;
- изменение языка;
- изменение месячного revenue goal;
- повторный запуск guided tour;
- feedback form;
- Reset demo data;
- logout.

Currency и timezone после onboarding не редактируются.

## 12. Обратная связь и аналитика демо

### 12.1. Feedback

Постоянная кнопка `Leave feedback` / `Оставить отзыв` доступна во всех разделах. Форма также находится в Settings.

Поля:

- rating: обязательное целое число 1–5;
- comment: optional, до 2 000 символов;
- desired_features: обязательный ответ до 2 000 символов на вопрос «Что должно появиться в продукте, чтобы вы захотели внедрить его у себя?».

Один аккаунт имеет один текущий feedback response. Повторная отправка обновляет его. Feedback переживает Reset demo data.

Форма никогда не блокирует работу. Ненавязчивое предложение оставить отзыв показывается после посещения трёх разных разделов либо двух разрешённых mutations. Его можно закрыть.

### 12.2. Product events

Фиксируется ограниченный whitelist:

- `login_succeeded`;
- `onboarding_completed`;
- `section_viewed`;
- `filter_changed`;
- `product_price_changed`;
- `inventory_movement_created`;
- `revenue_goal_changed`;
- `demo_reset`;
- `feedback_submitted`.

Event содержит `user_id`, `network_id`, type, timestamp, optional route и небольшую schema-validated metadata. В metadata запрещены password, cookies, arbitrary form text и feedback contents.

Browser-facing `POST /events` принимает только `section_viewed` и `filter_changed`; server-authoritative типы (`login_succeeded`, `onboarding_completed`, mutation events, `demo_reset` и `feedback_submitted`) записываются только из trusted server paths. Client telemetry ограничена 30 новыми событиями за 60 секунд и 300 за 24 часа на tenant; idempotent replay не расходует квоту и возвращает `Retry-After` при `429`.

## 13. Схема данных Railway PostgreSQL

### 13.1. Auth и tenancy

| Таблица            | Ключевые поля                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Better Auth tables | server-only user/account/session state, internal email, username alias, credential hash и session expiry                                                        |
| `app_users`        | `auth_user_id` → Better Auth user, `login_normalized UNIQUE`, `network_id UNIQUE`, `status`, `account_kind`, `expires_at`, `last_login_at`, `tour_completed_at`, `tour_skipped_at` |
| `networks`         | nullable до onboarding `name`, `owner_name`, `country_code`, `currency_code`, `timezone`, `language`, `onboarding_completed_at`; `demo_generated_for_date`, `demo_data_revision`, existing `demo_generator_version` |

`account_kind`: `demo | e2e`.

### 13.2. Демо-данные

| Таблица               | Ключевые поля                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `locations`           | `network_id`, `name`, `sort_order`                                                                 |
| `categories`          | `network_id`, `name`, `sort_order`                                                                 |
| `products`            | `network_id`, `category_id`, `name`, `current_price`, `current_unit_cost`, `active`                |
| `orders`              | `network_id`, `location_id`, `ordered_at`, `status`                                                |
| `order_items`         | `network_id`, `order_id`, `product_id`, `quantity`, `unit_price_at_sale`, `unit_cost_at_sale`      |
| `inventory_items`     | `network_id`, `name`, `unit`, optional `product_id`                                                |
| `inventory_balances`  | `network_id`, `location_id`, `inventory_item_id`, `on_hand`, `min_threshold`, UNIQUE location/item |
| `inventory_movements` | `network_id`, `location_id`, `inventory_item_id`, `type`, `quantity`, `occurred_at`                |
| `revenue_targets`     | `network_id`, `month`, `amount`, UNIQUE network/month                                              |
| `feedback_responses`  | `network_id UNIQUE`, `rating`, `comment`, `desired_features`, `submitted_at`, `updated_at`         |
| `product_events`      | `network_id`, `user_id`, `type`, `route`, `metadata`, `occurred_at`                                |
| `demo_generations`    | `network_id`, `generated_for_date`, `seed`, `version`, immutable UTC anchor in `created_at`          |

Все business tables используют UUID, `created_at`/`updated_at` по необходимости и обязательный `network_id`. Soft delete отсутствует.

### 13.3. Ограничения

- внешние ключи запрещают orphan records;
- `network_id` индексируется во всех tenant tables;
- time-series индексы используют `(network_id, occurred_at)` и `(network_id, location_id, occurred_at)`;
- money: exact-scale `numeric` с диапазоном `numeric(14,2)`, quantity: exact-scale `numeric` с диапазоном `numeric(14,3)`, timestamps: `timestamptz`; scale проверяется constraint до записи, чтобы PostgreSQL не выполнял silent rounding;
- RLS включён на всех tenant business tables без browser-facing разрешающих policies;
- migrations выполняются owner role, а Hono использует отдельную runtime role без ownership и `BYPASSRLS`;
- Hono задаёт server-derived `network_id` через `set_config('app.network_id', ..., true)` внутри транзакции; pooled connection не сохраняет tenant context между запросами;
- связанные UUID проверяются на принадлежность одной сети;
- browser-supplied `network_id` запрещён;
- Better Auth tables находятся в server-only schema и не участвуют в tenant RLS;
- feedback и events доступны только администратору через Railway database view/SQL client, отдельного admin UI нет.

## 14. Hono API

Базовый prefix: `/api/v1`. Все ответы JSON и содержат `requestId`.

### 14.1. Auth и onboarding

| Method | Route                  | Назначение                               |
| ------ | ---------------------- | ---------------------------------------- |
| `GET`  | `/health`              | Smoke-check Worker и доступности API     |
| `POST` | `/auth/login`          | Вход по login alias и password           |
| `POST` | `/auth/logout`         | Logout и очистка cookies                 |
| `GET`  | `/auth/me`             | Профиль, язык, tour и onboarding state   |
| `PUT`  | `/onboarding/language` | Сохранить первый язык                    |
| `POST` | `/onboarding/complete` | Сохранить сеть/точки и создать demo data |

### 14.2. Аналитика

| Method | Route        | Назначение                         |
| ------ | ------------ | ---------------------------------- |
| `GET`  | `/overview`  | KPI, charts, goal и alerts         |
| `GET`  | `/locations` | Карточки и comparison              |
| `GET`  | `/sales`     | Sales analytics и recent orders    |
| `GET`  | `/products`  | Product analytics и menu matrix    |
| `GET`  | `/inventory` | Balances, movements и stock alerts |

Analytics endpoints принимают `locationId`, `period` и cursor/page параметры там, где есть таблица. Допустимые periods фиксированы контрактом. Подписанный continuation
фиксирует `pageSize`: следующий запрос обязан повторить размер страницы, иначе API
возвращает `400 VALIDATION_ERROR`.

### 14.3. Разрешённые mutations

| Method  | Route                        | Назначение                       |
| ------- | ---------------------------- | -------------------------------- |
| `PATCH` | `/products/:productId/price` | Изменить current selling price   |
| `POST`  | `/inventory/movements`       | Создать `receipt` или `writeoff` |
| `PUT`   | `/settings/revenue-goal`     | Upsert цели текущего месяца      |
| `PUT`   | `/settings/language`         | Изменить язык                    |
| `PUT`   | `/settings/tour`             | Сохранить tour state             |
| `GET`   | `/feedback`                  | Получить текущий ответ           |
| `PUT`   | `/feedback`                  | Upsert текущего ответа           |
| `POST`  | `/events`                    | Записать client navigation/filter event |
| `POST`  | `/demo/reset`                | Восстановить исходный набор      |

Других business mutations в Demo MVP нет.

### 14.4. Формат ответа

Успех:

```json
{
  "data": {},
  "meta": {},
  "requestId": "uuid"
}
```

Ошибка:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Localized user-safe message",
    "fields": {}
  },
  "requestId": "uuid"
}
```

Коды: `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `INTERNAL_ERROR`.

## 15. Валидация и атомарность

- Клиентская валидация улучшает UX, серверная является обязательной.
- Shared Zod contracts используются React и Hono.
- Неизвестные mutation fields отклоняются.
- Все UUID проверяются на tenant ownership.
- Onboarding и demo generation выполняются атомарно и идемпотентно.
- Inventory movement и balance update выполняются одной database function.
- Runtime role не имеет прямого DML к inventory balances/movements; onboarding и Reset используют
  узкую tenant-scoped `SECURITY DEFINER` baseline function с полной проверкой location×item coverage.
- Reset полностью заменяет demo data одной атомарной database operation.
- Feedback и revenue goal используют upsert с уникальным tenant scope.
- Product event принимает только whitelist type и schema-validated metadata.
- Browser product events ограничены navigation/filter типами и quota 30/60 секунд, 300/24 часа на tenant; server-authoritative events не принимаются из browser.
- Размер JSON body ограничен 256 KiB.

## 16. Локализация и визуальная система

### 16.1. Локализация

- English и Русский поддерживаются полностью.
- English — default и fallback.
- UI, validation, states, dates, numbers и currency локализуются.
- Пользовательские названия не переводятся.
- Routes, API и database identifiers остаются английскими.
- Missing translation key обнаруживается тестом.

### 16.2. Визуальный стиль

Тема только светлая:

- тёплый off-white background;
- кремовые поверхности;
- тёмно-коричневый текст;
- кофейный accent для primary actions;
- зелёный для роста, янтарный для warning, красный для critical state;
- статус передаётся не только цветом;
- графики имеют различимые серии;
- shadcn/ui является основой компонентов.

Интерфейс должен выглядеть как готовый профессиональный analytics product, поскольку визуальное доверие является частью проверки идеи.

## 17. Responsive и accessibility

- mobile: 320–767 px;
- tablet: 768–1279 px;
- desktop: 1280 px и выше.

Требования:

- KPI переходят в 1–2 колонки на mobile;
- tables используют card representation или column priority;
- chart containers адаптируются без page-level horizontal scroll;
- формы доступны с клавиатуры и имеют корректные labels/errors;
- focus всегда видим;
- dialogs и navigation используют семантические primitives;
- contrast соответствует WCAG AA для основного текста и controls;
- reduced motion отключает необязательные animations.

Полный формальный WCAG-аудит не входит в Demo MVP.

## 18. Производительность и безопасность

### 18.1. Производительность

- первый полезный экран — до 3 секунд на обычном мобильном соединении;
- смена фильтра — до 1 секунды после ответа API;
- mutation — до 2 секунд без сетевого отказа;
- KPI загружаются раньше тяжёлых charts;
- routes используют code splitting;
- TanStack Query кэширует reads и точечно инвалидирует затронутые keys;
- recent orders используют pagination.

### 18.2. Безопасность

- только HTTPS;
- Railway database credentials доступны только Hyperdrive configuration, migration/admin CLI и локальному isolated test environment;
- Better Auth secret доступен только Worker и admin CLI;
- credentials, cookies и tokens не логируются;
- same-origin deployment и Origin checks для mutations;
- generic login errors;
- security headers: CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy` и frame protection;
- Zod validation и database constraints;
- все business queries scoped по server-derived `network_id`;
- feedback text не попадает в application logs или product event metadata;
- `bun audit` запускается перед release.

## 19. Наблюдаемость

Используется Cloudflare Workers Observability:

- structured JSON logs;
- `requestId`, route, method, status, durationMs и safe account identifiers;
- stack доступен только в server logs;
- отслеживаются 5xx, login failures, onboarding/reset failures и API latency;
- пользовательская ошибка показывает безопасное сообщение и request ID;
- Sentry и сторонний client collector отсутствуют.

## 20. Тестирование

### 20.1. Unit

- financial formulas;
- period comparison и timezone boundaries;
- menu matrix;
- stock statuses и alert calculation;
- login/feedback/mutation schemas;
- deterministic generator helpers;
- event whitelist.

### 20.2. Integration

Проверяются:

- admin account creation;
- login/logout/session expiry;
- tenant isolation минимум между двумя accounts;
- onboarding idempotency;
- product price update;
- receipt/writeoff и negative-stock rejection;
- revenue goal upsert;
- feedback upsert;
- atomic Reset;
- API error envelope.

Integration tests используют изолированную локальную PostgreSQL database и никогда не production data. Поскольку существует только один удалённый Railway PostgreSQL service, destructive production smoke/E2E операции разрешены только для аккаунта с `account_kind = 'e2e'`. Runner обязан проверять этот признак до mutation или cleanup и не может перечислять, изменять либо удалять demo accounts.

### 20.3. Component

- login, language и onboarding forms;
- filters;
- price, inventory, goal и feedback dialogs;
- loading/empty/error states;
- mobile navigation;
- accessible dialogs и form errors.

### 20.4. Playwright E2E

Обязательные journeys:

1. Login → Language → Onboarding → Overview → Tour.
2. Смена location/period и согласованное обновление аналитики.
3. Изменение цены обновляет current unit margin, не меняя historical sales.
4. Receipt/writeoff меняет balance и stock alert.
5. Revenue goal меняет Overview progress.
6. Feedback сохраняется и повторно открывается с введёнными значениями.
7. Reset восстанавливает данные и сохраняет account/network preferences и feedback.
8. Основной путь работает на desktop и mobile.

После окончания разработки E2E account и его tenant data удаляются отдельной защищённой командой.

## 21. Production deployment

Используется только одно облачное окружение:

- один Cloudflare Worker;
- один Railway Hobby PostgreSQL service;
- одна cache-disabled Cloudflare Hyperdrive configuration;
- бесплатный `*.workers.dev` URL;
- одна production remote database; integration tests используют только локальную изолированную PostgreSQL;
- staging, preview и отдельная remote test database отсутствуют.

Cloudflare configuration:

- `/api/*` обрабатывается Worker;
- static assets обслуживаются Cloudflare;
- `not_found_handling = "single-page-application"`;
- `assets.run_worker_first` включает `/api/*`;
- compatibility date зафиксирована;
- Observability включён;
- Cron Triggers отсутствуют;
- Hyperdrive создаётся из Railway `DATABASE_PUBLIC_URL`; database credentials не дублируются в Worker variables;
- `BETTER_AUTH_SECRET` находится в Cloudflare Secrets, а non-secret base URL — в Worker environment;
- production migrations применяются вручную до совместимого Worker release.

Railway-native backups, point-in-time recovery и иная disaster-recovery автоматизация находятся
за пределами Demo MVP и не являются release prerequisite для Hobby-плана.

Release gate:

1. чистый git worktree;
2. успешные lint, typecheck и unit tests;
3. успешный production build;
4. применённые migrations;
5. smoke-check `/api/v1/health`;
6. smoke-check login, Overview и feedback на e2e account.

## 22. Критерии готовности Demo MVP

Demo MVP готов, когда:

- администратор создаёт до 15 отдельных accounts без хранения открытых паролей;
- пользователь входит по login alias и password;
- onboarding создаёт персональную сеть и demo data;
- Overview, Locations, Sales, Products, Inventory и Settings работают на общих данных;
- RU/EN переключаются без потери состояния;
- filters и comparison согласованы между экранами;
- три разрешённые группы mutations дают видимый связанный результат;
- Reset восстанавливает только текущую сеть;
- feedback и product events сохраняются с tenant scope;
- два аккаунта не видят и не изменяют данные друг друга;
- основной путь работает на desktop и mobile;
- приложение развернуто на `workers.dev` с одним Railway PostgreSQL service и Hyperdrive binding;
- в UI отсутствуют функции, заявленные как out of scope;
- можно выдать 15 персональных доступов и оценить достижение цели «три заинтересованных владельца».

## 23. Definition of Done для фичи

Фича считается завершённой, если:

- реализовано предусмотренное desktop/mobile поведение;
- есть loading, empty, error и success state по смыслу фичи;
- RU/EN строки добавлены;
- shared contract и server validation согласованы;
- tenant isolation соблюдена;
- секреты и пользовательский feedback не попадают в logs;
- добавлены соразмерные unit/component/integration tests;
- критичный пользовательский путь покрыт Playwright, если фича в него входит;
- lint, typecheck и затронутые tests проходят;
- PRD/API/schema обновлены при изменении поведения.
