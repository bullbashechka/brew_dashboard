# Этап 3 — итоговый разбор auth/session и edge cases

Дата: 2026-08-24

## Результат

Этап 3 реализован без публичной регистрации и без доверия к tenant scope,
переданному браузером. Session state хранится в PostgreSQL через Better Auth,
а клиент получает только opaque cookie и безопасный API envelope.

## Acceptance contract

- Администратор создаёт `demo`/`e2e`-аккаунты, а лимит учитывает только активные
  demo accounts и не допускает гонку на границе 15.
- Login/logout/me используют единый контракт; неверные, отключённые и истёкшие
  учётные записи получают одинаковую generic authentication failure.
- Session cookie имеет `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`; токен
  не попадает в JSON, логи или client bundle.
- Каждая authenticated DB-операция проверяет Better Auth session и `app_users`,
  затем устанавливает transaction-local tenant context из серверной записи.
- Mutation requests требуют exact same-origin `Origin`, `application/json` и
  body не более 256 KiB; ответы содержат собственный request ID.
- Reset/disable/delete отзывает затронутые sessions, а logout отзывает только
  текущую session и остаётся идемпотентным.

## Что реализовано

- Request-scoped `pg.Client`/Drizzle, Hyperdrive connection path, transaction
  context и advisory locks для login, auth user и active-demo quota.
- Better Auth 1.7.1 с явной схемой Drizzle adapter, username/password sign-in,
  database rate-limit storage, выключенным cookie cache и закрытыми public
  signup/recovery/password-changing surface.
- Migration для `auth.rate_limits`; login limiter — 5 попыток за 15 минут на
  нормализованный login и Cloudflare client IP.
- Admin service и CLI для create/reset/disable/delete с нормализацией login,
  case-insensitive uniqueness, masked/generated password, production guard,
  typed delete confirmation и техническим `.invalid` email.
- `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`,
  `GET /api/v1/auth/me`, middleware, generic error mapper и скрытие Better Auth
  catch-all routes.
- Strict contracts для login/logout/session/profile; pre-onboarding profile
  fields допускают `null`, чтобы пустая сеть не вызывала contract drift.
- Изолированный integration runner подключает тестовый `brew_runtime` как
  отдельный non-owner runtime role с временным паролем.

## Edge cases, подводные камни и принятые решения

1. **Enumeration через login.** Nonexistent login, wrong password, disabled и
   expired account возвращают одинаковые status/code/message/shape. Решение:
   generic 401 и отсутствие raw Better Auth details.
2. **Сессия после reset/disable/expiry.** На следующем запросе database lookup
   отклоняет session, очищает cookie и возвращает 401; reset и disable удаляют
   все sessions аккаунта.
3. **Renewal без незаметного logout.** Better Auth обновляет session, когда она
   приближается к expiry; `/auth/me` проверяет, что `updated_at` и `expires_at`
   действительно сдвинулись. Cookie cache отключён, поэтому отзыв виден сразу.
4. **Две параллельные admin-команды.** Advisory lock берётся до count/create;
   при `14 + 2` активных demo accounts проходит ровно одна команда.
5. **E2E, disabled и expired accounts.** Они не расходуют demo quota; active
   count учитывает только `demo + active + не истёкшие` записи.
6. **Rollback при частичном создании.** Auth user, account, network и
   `app_users` создаются одной owner transaction, поэтому ошибка не оставляет
   orphan records.
7. **Подмена tenant.** `networkId` из body/query/header не используется; scope
   получается только из проверенного `app_users`, устанавливается через
   transaction-local `set_config`, а RLS отсекает чужие строки.
8. **Origin и content type.** Отсутствующий, чужой или неоднозначный Origin,
   `text/plain`, form-data и прочие mutation bodies отвергаются до handler.
9. **Malformed JSON и слишком большой body.** Ошибка разбора login остаётся
   generic 401; остальные validation errors — 400 envelope; размер ограничен
   256 KiB, включая streamed/chunked запросы.
10. **Request ID spoofing и неизвестные пути.** Входящий `X-Request-Id`
    игнорируется; middleware создаёт новый UUID и синхронно отражает его в
    header/body, включая unknown paths вне `/api/v1`.
11. **Set-Cookie с `Expires` comma.** Cookie splitter учитывает запятые внутри
    даты и не теряет отдельные cookie/clear-cookie directives.
12. **Rate-limit concurrency.** Лимитер хранит счётчик в DB row и защищает
    increment advisory lock; параллельные попытки не обходят максимум.
13. **Публичная auth surface.** Better Auth handler не смонтирован catch-all;
    signup, recovery, email confirmation и user-facing password change наружу
    не выставлены.
14. **Секреты и технические данные.** Secret берётся только из Worker
    environment, technical email/password hash/session token не сериализуются в
    API, логи или client bundle.

## Review loop

Перед реализацией выполнен отдельный SOL preflight с разбором рисков и edge
cases. После реализации независимый `gpt-5.6-sol` reviewer выполнил повторный
review и PostgreSQL integration run.

- Первый review выявил malformed-JSON 500, слишком агрессивный global rate
  limit для `/get-session`, отсутствие request ID на unknown path и неточный
  renewal test. Все четыре замечания исправлены.
- Финальный rerun: **14/14 integration tests, 81 assertions**.
- Финальная оценка независимого reviewer: **9.7/10**.
- Blocker/high findings: нет. Minor OpenAPI note по logout уже присутствует в
  текущем `logoutRoute` как response `400`.

## Проверки

Успешно выполнены:

- `bun run lint`
- `bun run typecheck`
- `bun run test` — 8 contracts, 24 backend unit, 2 webapp tests; 0 failures
- `bun run db:check`
- `bun run build`
- `bunx prettier --check ...`
- `git diff --check`
- независимый isolated PostgreSQL integration run: 14/14, 81 assertions

Live Wrangler/Cloudflare Hyperdrive auth smoke и запуск CLI wrappers как
отдельных subprocess не выполнялись; они не являются blocker для локального
Stage 3 acceptance и отмечены как отдельные rollout checks.

