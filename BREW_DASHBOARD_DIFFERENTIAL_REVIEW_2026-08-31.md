# Differential security review — Brew Dashboard

**Дата:** 2026-08-31  
**Baseline:** `79ec3dc` (`Optimize concurrent analytics reads and disable PostgreSQL JIT`)  
**Объект:** незакоммиченный diff относительно `HEAD`, 54 изменённых отслеживаемых файла и 29 новых файлов до создания этого отчёта  
**Размер репозитория:** 210 файлов исходного кода (`ts/tsx/js/mjs/sql`)  
**Стратегия:** SURGICAL для большого репозитория, 100% HIGH-risk изменений и trust boundaries проверены углублённо; остальные изменённые файлы проверены на поверхности и по связям  
**Итоговая рекомендация:** **REJECT для merge/deploy до устранения HIGH-находок и выполнения заблокированных интеграционных проверок**

## 1. Executive summary

Изменения заметно повышают исходный уровень защиты: добавлены обязательный TOTP/backup-code MFA, распределённый rate limiting через Durable Object, разделение `brew_auth_runtime`/`brew_app_runtime`, RLS для `app_users`, отзыв legacy-роли, security headers, псевдонимизация логов и шифрование резервных копий.

При этом release/recovery контур пока не доказывает собственные security-инварианты. Конфигурация может объявить Stage C без фактического отзыва legacy-роли; bootstrap-флаг способен заменить ключ, которым Better Auth шифрует MFA-секреты; backup tooling не умеет выполнить описанный restore; TLS-параметры owner-соединения при `pg_dump` понижаются до `sslmode=require`. Новый MFA-путь также не покрыт backend integration-тестом.

| Уровень | Количество | Оценки |
|---|---:|---|
| Critical | 0 | — |
| High | 5 | 9/10, 8/10, 8/10, 8/10, 7/10 |
| Medium | 3 | 6/10, 6/10, 5/10 |
| Low | 3 | 4/10, 4/10, 3/10 |

## 2. Findings

### F-01 — Restore-процесс не может восстановить готовую к запуску защищённую БД

**Severity:** HIGH — **9/10**  
**Confidence:** HIGH  
**Класс:** Availability / disaster recovery / privilege restoration

**Доказательства**

- `backend/scripts/backup-dump.ts:131-134` запускает `pg_dump --format=custom --no-owner --no-privileges`.
- `backend/scripts/backup-crypto.ts:50-100` умеет только проверить GCM-tag и уничтожает plaintext в sink.
- `backend/scripts/backup-verify.ts:16-32` только вызывает verification; команды расшифрования или `pg_restore` нет.
- `package.json:40-41` содержит только `backup:dump` и `backup:verify`, но не `backup:restore`.
- `docs/backup-recovery.md:15-19` требует «decrypt/restore», не приводя исполнимой команды.
- `backend/drizzle/0018_split-runtime-roles.sql:1-36` создаёт роли и выдаёт grants как миграцию.
- `backend/scripts/provision-runtime-roles.ts:21-30` выполняет только `ALTER ROLE ... LOGIN PASSWORD`; отсутствующие роли не создаёт и grants не применяет.
- Поиск по проекту не нашёл `pg_restore`, decrypt pipeline или restore entrypoint.

`pg_dump` не переносит cluster-level роли, а `--no-privileges` исключает grants. При этом custom dump переносит таблицу журнала Drizzle `__drizzle_migrations`. После восстановления на чистый PostgreSQL мигратор увидит миграции 0018/0020–0025 уже выполненными и не переиграет создание ролей, grants и hardening. Документированный provisioning затем завершится ошибкой на отсутствующих ролях либо, если роли созданы вручную, не восстановит grants.

**Атакующий/аварийный сценарий**

1. Происходит потеря production database или требуется изолированный restore drill.
2. Оператор успешно проверяет GCM-tag архива и восстанавливает dump вручную.
3. Runtime-роли и grants отсутствуют, но миграционный журнал утверждает, что privilege migrations уже применены.
4. Приложение не может подключиться или получает непредсказуемую, вручную собранную модель привилегий.
5. Под давлением инцидента оператор может выдать чрезмерные права, отключить RLS либо увеличить RTO до неприемлемого значения.

**Blast radius:** вся production БД, оба runtime-контура, все tenant/auth данные; полный outage либо нарушение least privilege после ручного восстановления.

**Требуемое исправление**

1. Добавить `backup:restore` с потоковым AES-GCM decrypt прямо в `pg_restore`, без долговременного plaintext-файла.
2. До restore сверять manifest (`file`, `bytes`, `sha256`, `format`, `keyId`) и после decrypt проверять сигнатуру custom dump.
3. Вынести создание ролей, hardening и grants в идемпотентный owner-only bootstrap, который исполняется после restore независимо от Drizzle journal.
4. Restore должен работать только с явно подтверждённой новой/изолированной target database и отказываться от source/production target.
5. Добавить автоматический drill: dump → encrypted artifact → clean PostgreSQL → restore → role/RLS/tenant/auth smoke.

**Критерий закрытия:** одно документированное действие восстанавливает чистую БД, после чего `db:check`, split-role smoke, auth+MFA и tenant-isolation проверки проходят без ручных SQL-grants.

---

### F-02 — `--provision-auth-secret` может необратимо заблокировать все MFA-аккаунты

**Severity:** HIGH — **8/10**  
**Confidence:** HIGH  
**Класс:** Key management / authentication availability

**Доказательства**

- `scripts/release-deploy.mjs:10-19` разрешает bootstrap-флаг при любом production deploy.
- `scripts/release-deploy.mjs:54-63` без preflight генерирует новое значение `BETTER_AUTH_SECRET` и передаёт его через `--secrets-file`.
- Проверка существования secret выполняется только **после** deploy и проверяет лишь имя (`scripts/release-deploy.mjs:69-85`).
- Ограничение «только если secret ещё не существует» есть только в документации (`docs/production-release.md:59-61`).
- `backend/src/auth/better-auth.ts:33-39` использует `BETTER_AUTH_SECRET` как Better Auth secret.
- Better Auth 1.7.1 шифрует TOTP secret этим ключом: `node_modules/better-auth/dist/plugins/two-factor/index.mjs:133-137`; backup codes также зависят от `secretConfig` (`:125`, `:148`).

**Атакующий/аварийный сценарий**

1. Оператор повторно запускает deploy с `--provision-auth-secret` по ошибке или по устаревшему runbook/snippet.
2. Worker получает новый Better Auth secret.
3. Старые сессии перестают валидироваться; зашифрованные TOTP secrets и backup codes больше не расшифровываются.
4. Все уже enrolled пользователи теряют возможность войти; восстановление требует возврата старого ключа либо массового admin MFA reset.

**Blast radius:** все активные сессии и все MFA-enrolled аккаунты; возможен полный auth outage.

**Требуемое исправление**

1. Удалить bootstrap-флаг из обычного `release:deploy`.
2. Создать отдельную one-time команду, которая перед записью получает `wrangler secret list` и fail-closed отказывается, если `BETTER_AUTH_SECRET` уже существует.
3. Для ротации разработать отдельный подтверждаемый workflow: сохранить старый ключ, пере-зашифровать MFA material либо явно выполнить контролируемый MFA reset и revoke sessions.
4. Добавить unit-тест: существующее имя secret делает bootstrap невозможным до deploy.

**Критерий закрытия:** обычный deploy физически не способен изменить auth secret; повторный bootstrap завершается до любых внешних изменений.

---

### F-03 — Stage C является самообъявленной строкой и не доказывает отзыв `brew_runtime`

**Severity:** HIGH — **8/10**  
**Confidence:** HIGH  
**Класс:** Release gate / database authorization

**Доказательства**

- `scripts/release-deploy.mjs:38-40` проверяет clean worktree, config Stage C и запускает `release:verify`.
- `scripts/release-verify.mjs:19-30` выполняет локальные suites и Wrangler dry-run, но не запускает `db:smoke:hyperdrive`.
- `scripts/release-config.mjs:74-103` доказывает только значение `RUNTIME_ROLE_SPLIT_STAGE=C` и разные Hyperdrive IDs.
- Фактический revoke — отдельная ручная команда (`docs/production-release.md:45-56`, `backend/scripts/revoke-legacy-runtime.ts:20-30`).
- Smoke действительно проверяет `legacyRuntimeRevoked` (`backend/scripts/hyperdrive-smoke-worker.ts:247-256,293-311`), но deploy от результата smoke не зависит.

**Атакующий/аварийный сценарий**

1. Оператор коммитит Stage C и два разных Hyperdrive ID, но пропускает revoke либо запускает его не в той Railway environment.
2. `release:deploy` проходит все автоматические gates.
3. Legacy `brew_runtime` остаётся LOGIN и/или сохраняет grants на `app` и `auth`.
4. Ранее утёкшая legacy connection string продолжает давать доступ, обходя новое разделение auth/app ролей.

**Blast radius:** оба DB trust boundary, auth/session/MFA таблицы и tenant data в зависимости от сохранившихся grants.

**Требуемое исправление**

1. Сделать post-revoke Hyperdrive smoke обязательным входом `release:deploy`.
2. Gate должен быть привязан к текущим Worker/Hyperdrive IDs и target database, а не к вручную выставленной строке.
3. Допустимый вариант: краткоживущая подписанная attestation с DB identity, migration head, role/grant digest и timestamp, потребляемая deploy один раз.
4. Добавить негативный release-тест: Stage C + `legacyRuntimeRevoked=false` блокирует deploy.

**Критерий закрытия:** Stage C deploy невозможно запустить, пока реальный production data plane не подтвердил `legacyRuntimeRevoked=true` и корректные grants/RLS для обоих Hyperdrive.

---

### F-04 — Backup-команда понижает TLS policy owner-соединения

**Severity:** HIGH — **8/10**  
**Confidence:** HIGH  
**Класс:** Transport security / credential exposure

**Доказательства**

- `backend/scripts/backup-dump.ts:70-83` принимает production owner URL.
- `backend/scripts/backup-dump.ts:86-109` разбирает URL на `PGHOST/PGUSER/PGPASSWORD/...`, удаляет исходный URL и `PGSSLMODE`, затем для любого remote host принудительно задаёт `PGSSLMODE=require`.
- URL query parameters, включая `sslmode=verify-full`, не переносятся в child process; hostname verification не задаётся.
- В child передаются owner credentials (`backend/scripts/backup-dump.ts:103-107`).

**Атакующий сценарий**

1. В secret manager хранится URL с `sslmode=verify-full` и доверенным CA.
2. Backup wrapper отбрасывает query policy и запускает `pg_dump` с `sslmode=require`.
3. При контроле DNS/маршрута или ошибочной endpoint-конфигурации соединение может быть установлено без проверки имени сервера.
4. Злоумышленник получает owner password либо отдаёт поддельный dump, который оператор считает production backup.

**Blast radius:** owner database credential и потенциально полный доступ к production DB; целостность резервной копии.

**Требуемое исправление**

1. Для remote backup требовать `sslmode=verify-full`, явно передавать CA/root certificate и server name.
2. Сохранять более строгие URL TLS options; отвергать `disable`, `allow`, `prefer` и не понижать `verify-full`.
3. Добавить unit-тесты на URL query → libpq environment и отказ при неполной verification policy.

**Критерий закрытия:** remote `pg_dump` стартует только с hostname+CA verification; более строгая входная конфигурация никогда не ослабляется.

---

### F-05 — Security-critical MFA flow не покрыт backend integration-тестами

**Severity:** HIGH — **7/10**  
**Confidence:** HIGH  
**Класс:** Test assurance / authentication

**Доказательства**

- `backend/tests/unit/stage3.test.ts:63-82` проверяет только преобразование методов, TOTP URI и флаг.
- В `backend/tests/integration/*` нет вызовов `/auth/mfa/setup`, `/auth/mfa/verify`, `MFA_REQUIRED`, backup code или lockout.
- `webapp/e2e/production.spec.ts:32-56` содержит happy-path enrollment, но это guarded production test и в текущем review не был выполнен.
- Нет теста challenge уже enrolled пользователя, одноразовости backup code, пяти неудачных попыток/lockout, Set-Cookie session rotation, запрета app routes до enrollment и admin MFA reset.

Изменение затрагивает 12 auth DB-open call sites в `backend/src/auth/http.ts`, 11 точек подключения auth middleware в `backend/src/index.ts` и фактически все 22 API routes. Комментарий в `mfaVerifyHandler` отдельно описывает нетривиальную ротацию session token (`backend/src/auth/http.ts:758-763`), но этот инвариант не закреплён тестом.

**Атакующий/регрессионный сценарий**

Рефакторинг Better Auth adapter/cookie forwarding меняет форму response или порядок session rotation. Unit suites остаются зелёными, но enrollment создаёт TOTP row и удаляет старую сессию без доставки валидной новой cookie; пользователи блокируются либо pre-MFA session получает доступ дальше middleware.

**Требуемое исправление**

Добавить isolated PostgreSQL integration suite для полного MFA state machine:

1. password login → setup required → app route 403 `MFA_REQUIRED`;
2. setup с повторной проверкой password → неверный TOTP → верный TOTP → rotated cookie;
3. новый login enrolled user → challenge → TOTP и backup code;
4. backup code работает один раз;
5. lockout и recovery после window;
6. logout/reset password/reset MFA отзывают все relevant sessions.

**Критерий закрытия:** state-machine suite проходит против реального PostgreSQL и pinned Better Auth 1.7.1; production journey также выполнен хотя бы один раз перед release.

---

### F-06 — Pre-MFA session раскрывает полный tenant profile

**Severity:** MEDIUM — **6/10**  
**Confidence:** HIGH  
**Класс:** Authentication boundary / information disclosure

**Доказательства**

- `backend/src/index.ts:599-603` утверждает, что `/auth/me` «exposes no tenant data», но подключает `requireMfaSetupAuthentication`.
- `backend/src/auth/http.ts:234-292` загружает network и формирует полный `profile`: `networkId`, `networkName`, `ownerName`, country, currency, timezone, onboarding и demo metadata.
- `backend/src/auth/http.ts:439-449` возвращает тот же profile сразу после password-only login для unenrolled account.
- `backend/src/auth/http.ts:809-817` возвращает полный profile через `/auth/me`.

**Атакующий сценарий**

Злоумышленник получает пароль существующего, но ещё не enrolled аккаунта. Не проходя MFA, он получает tenant identifiers и бизнес-метаданные через login response или `/auth/me`. Остальные app routes корректно блокируются, поэтому влияние ограничено metadata disclosure.

**Требуемое исправление:** использовать отдельную минимальную pre-enrollment session response (`mfaSetupRequired`, user/login only) и не загружать/не возвращать tenant profile до успешной MFA verification. `/auth/me` для такого состояния должен возвращать минимальный enrollment state либо `MFA_REQUIRED`.

---

### F-07 — Runtime MFA posture fail-open при пропущенном или ошибочном флаге

**Severity:** MEDIUM — **6/10**  
**Confidence:** HIGH  
**Класс:** Secure configuration

**Доказательства**

- `backend/src/auth/http.ts:89-95` считает MFA обязательным только при точной строке `"1"`; `undefined`, `true`, `"true"`, опечатка или неизвестное значение выключают enforcement.
- `backend/src/http/types.ts:14` объявляет binding optional.
- `scripts/release-config.mjs:71-73` защищает штатный wrapper, но прямой `wrangler deploy` или иной deployment path может его обойти.
- `.dev.vars.example:4` намеренно использует `0`, поэтому простая инверсия default невозможна без явного dev-mode boundary.

**Атакующий/операционный сценарий:** production deploy выполняется в обход wrapper или с ошибочным binding; новые/unenrolled аккаунты получают password-only доступ. Уже enrolled аккаунты всё ещё могут вызвать challenge Better Auth, но mandatory enrollment больше не гарантирован.

**Требуемое исправление:** вне явного loopback/test режима отсутствие или неизвестное значение `MFA_REQUIRED` должно останавливать Worker/auth handler. Разрешать `0` только вместе с явным local-test mode, добавить тесты `undefined`, `"true"`, мусорного значения и production request.

---

### F-08 — E2E child processes наследуют новые operator secrets

**Severity:** MEDIUM — **5/10**  
**Confidence:** MEDIUM  
**Класс:** Secret isolation / subprocess boundary

**Доказательства**

- `backend/scripts/run-production-e2e.ts:41-54` копирует весь `process.env` и удаляет ограниченный denylist.
- `backend/scripts/run-system-e2e.ts:26-44` делает то же для Worker child.
- Denylist не включает новые `AUTH_RUNTIME_DATABASE_PASSWORD`, `APP_RUNTIME_DATABASE_PASSWORD`, `BACKUP_ENCRYPTION_KEY`, `LOG_PSEUDONYM_SECRET`, а также provider-specific tokens.
- Production E2E запускается через `railway run` (`docs/production-release.md:84-89`), то есть parent environment содержит инфраструктурные variables.

**Атакующий сценарий:** скомпрометированный test dependency, reporter, plugin или диагностический dump читает лишние environment variables из child process и выводит их в лог/артефакт. Текущая log-canary проверка знает только заранее перечисленные canaries и не обнаружит произвольный унаследованный secret.

**Требуемое исправление:** заменить denylist на минимальный allowlist окружения для Playwright/Worker child. Секрет production E2E передавать отдельно и очищать; добавить тест, который инжектирует неизвестный `*_SECRET`/`*_PASSWORD` и проверяет его отсутствие в child environment.

---

### F-09 — `login_succeeded` записывается до завершения обязательного MFA

**Severity:** LOW — **4/10**  
**Confidence:** HIGH  
**Класс:** Audit integrity

**Доказательства**

- `backend/src/auth/http.ts:407-425` обновляет `lastLoginAt` и пишет `login_succeeded` сразу после password login.
- Только затем `backend/src/auth/http.ts:439-449` возвращает `mfaSetupRequired`.
- После успешной MFA verification событие записывается повторно (`backend/src/auth/http.ts:767-784`).

Password-only попытка unenrolled пользователя отражается как успешный login, а завершённый enrollment создаёт второе событие. Это искажает incident timeline, last-login и продуктовые метрики.

**Требуемое исправление:** разделить `password_verified`/`mfa_challenge_issued` и `login_succeeded`; последнее и `lastLoginAt` фиксировать только после завершения требуемого MFA.

---

### F-10 — Production admin всё ещё допускает вручную выбранный пароль

**Severity:** LOW — **4/10**  
**Confidence:** HIGH  
**Класс:** Credential policy

**Доказательства**

- `backend/scripts/admin-create-user.ts:13-29` сохраняет production-совместимый `--interactive-password`.
- `packages/contracts/src/index.ts:148` требует только длину 12–128.
- Генерируемый пароль криптографически сильный (`backend/src/admin/accounts.ts:36`), но флаг позволяет его обойти.

Это не обход MFA, однако оператор может создать повторно используемый или предсказуемый первый фактор. Для production demo/e2e issuing это ненужная степень свободы.

**Требуемое исправление:** запретить `--interactive-password` для remote database/production confirmation; оставить только generated one-time credentials. Если ручной пароль нужен локальным тестам, разрешать его только для loopback DB.

---

### F-11 — Проверка backup directory разрешает подкаталоги home вопреки runbook

**Severity:** LOW — **3/10**  
**Confidence:** HIGH  
**Класс:** Operational data handling

**Доказательства**

- `backend/scripts/backup-dump.ts:53-67` запрещает только точное равенство home, но не `home/...`.
- `docs/backup-recovery.md:23-24` требует каталог вне home.
- Тест `backend/tests/unit/backup.test.ts:45-53` не проверяет descendant home path.

Архив зашифрован и имеет mode `0600`, поэтому влияние ограничено риском попадания ciphertext/manifest в пользовательскую синхронизацию, индексацию или ошибочный retention scope.

**Требуемое исправление:** отклонять `resolved.startsWith(home + path.sep)` и добавить unit-тест.

## 3. Adversarial analysis

### Модель угроз

Проверены следующие роли атакующего:

1. внешний анонимный атакующий с контролем source IP и login spray;
2. атакующий с украденным паролем, но без второго фактора;
3. пользователь с валидной tenant session, пытающийся выйти за RLS boundary;
4. обладатель старой `brew_runtime` connection string;
5. атакующий с контролем DNS/маршрута backup-host → PostgreSQL;
6. скомпрометированная test/build dependency с доступом к child process environment;
7. ошибающийся production operator во время deploy, key bootstrap или disaster recovery.

### Проверенные trust boundaries

- browser → Hono API: strict JSON/origin/body limits, secure cookies, MFA state;
- Hono → Better Auth: internal endpoints, response classification, session rotation;
- Worker → PostgreSQL: отдельные Hyperdrive bindings, auth/app roles, RLS context;
- Worker → Durable Object: HMAC-derived keys, bounded payloads, fail-closed mutations;
- operator → Cloudflare/Railway: release gates, secret lifecycle, smoke proof;
- operator → backup artifact/restore target: authenticated encryption, TLS, grants/roles;
- parent process → Playwright/workerd child: environment secret isolation.

### Положительно подтверждённые свойства

- App routes используют `requireAuthentication`; pre-enrollment session не проходит их при `MFA_REQUIRED=1` (`backend/src/auth/http.ts:499-507`).
- Mutation rate limiting fail-closed при недоступном Durable Object (`backend/src/auth/http.ts:516-520`); reads получают bounded memory fallback.
- Durable Object валидирует размеры ключа/window/max и сериализует bucket update (`backend/src/http/rate-limit-actor.ts:27-99`).
- TOTP secret и backup codes хранятся зашифрованными Better Auth, а не plaintext.
- `brew_auth_runtime` и `brew_app_runtime` разделены по schema/grants, runtime роли `NOBYPASSRLS`; smoke проверяет grants, RLS и legacy revoke.
- Backup ciphertext использует AES-256-GCM с уникальным nonce, atomic rename и mode `0600`; tampering-тест проходит.
- API responses получают CSP, HSTS, nosniff, frame deny, no-store и no-referrer.
- Сырые user/network identifiers заменяются keyed pseudonyms в structured logs.

## 4. Test coverage и validation

### Выполнено в рамках review

- `bun run test` — **PASS**:
  - contracts: 16 pass;
  - backend unit: 60 pass;
  - webapp unit/component: 55 pass;
  - release/build/log-safety tests: 8 pass.
- `git diff --check` — **PASS**, whitespace errors не найдено.

### Ранее выполнено на этом же diff

- `bun run lint` — PASS.
- `bun run typecheck` — PASS.
- `bun run build` и build-artifact secret scan — PASS.
- `bun run db:check` — PASS.
- dependency audit и gitleaks/security scan — PASS; одна документированная временная moderate exception для esbuild истекает 2026-09-30.

### Заблокировано / не доказано

- Integration PostgreSQL: последний запуск дал **31 pass / 7 fail**, failures вызваны Docker PostgreSQL `No space left on device` и PANIC checkpointer. Миграции 0024/0025 и финальные split-role assertions после них не подтверждены на чистой реальной БД.
- Local Playwright E2E: Chromium заблокирован macOS MachPort permission.
- Guarded production E2E: test обнаруживается, но не запускался с production account.
- Полный encrypted dump → clean restore → runtime bootstrap drill отсутствует как код и как тест.

Зелёные unit/type/lint/build проверки не компенсируют эти пробелы, поскольку primary security signals находятся в PostgreSQL grants/RLS, Better Auth session rotation и реальном recovery path.

## 5. Quantitative blast radius

| Поверхность | Количественная оценка |
|---|---:|
| Изменённые tracked files | 54 |
| Новые files до отчёта | 29 |
| Всего review artifacts | 83 |
| Изменение tracked diff | +2066 / -536 строк |
| API routes в Worker | 22 `app.openapi` registrations |
| Auth middleware attachment points | 11 прямых/loop registrations |
| DB-open sites в `auth/http.ts` | 12 |
| Новые versioned migrations | 11 (`0015`–`0025`, с пропусками snapshots по генератору) |
| Runtime DB roles | 3 затронуты: legacy + auth + app |
| Production Hyperdrive bindings | 2 |
| Durable Object shards | 32 |

Максимальный blast radius имеют F-01/F-02/F-03/F-04: они затрагивают либо все аккаунты и tenant данные, либо owner credential, либо способность восстановить весь сервис.

## 6. Historical context

### История security-critical кода

- `c21d75b` — первоначальная auth/account administration: session revoke, login flow, session identity.
- `10b34df` — active profile и atomic onboarding.
- `84395d8` — account locks, rate limiting и concurrency hardening.
- `c453452` — tenant context/RLS и release hardening.
- `b22345f` — production release/deploy tooling и secret bootstrap.
- `79ec3dc` — read-lock optimization и PostgreSQL JIT settings; текущий baseline.

`git blame` показывает, что текущий diff перерабатывает код, происходящий из этих security-sensitive commits. Поиск `git log -S` по `sessionId` и login limiter не обнаружил удаление ранее документированного CVE-fix; удалённый `sessionId` в request context не имел downstream consumers. Основной риск — не возврат старой уязвимости, а новые межсистемные инварианты, которые не закреплены release/restore gates.

История `scripts/release-deploy.mjs` показывает, что permissive auth-secret bootstrap существует с `b22345f`; текущий diff усиливает Stage C config check, но сохраняет bootstrap hazard и не связывает deploy с фактическим DB smoke.

## 7. Рекомендуемый порядок исправлений

1. **P0 — ключи и deploy:** убрать перезаписываемый auth-secret bootstrap из deploy; сделать реальный post-revoke smoke обязательным Stage C gate.
2. **P0 — recovery:** реализовать restore pipeline и идемпотентный runtime-role/grant bootstrap; провести clean restore drill.
3. **P0 — transport:** исправить backup TLS на `verify-full` без downgrade.
4. **P1 — auth assurance:** добавить PostgreSQL integration state-machine для MFA, включая cookie rotation, backup codes и lockout.
5. **P1 — boundary:** минимизировать pre-MFA response, сделать runtime MFA configuration fail-closed.
6. **P1 — secret isolation:** перевести child processes на environment allowlist.
7. **P2 — audit/operations:** исправить login audit semantics, запретить production interactive password и home descendants.
8. Освободить Docker storage без удаления пользовательских данных, затем повторить integration suite на чистой БД; устранить macOS browser permission и прогнать E2E.

## 8. Merge/deploy decision

**Решение: REJECT.**

Для изменения authentication, MFA, database authorization, secrets и disaster recovery недостаточно локально зелёных unit suites. Минимальные условия пересмотра решения:

1. F-01–F-05 закрыты кодом и тестами.
2. Clean PostgreSQL migrations, split-role/RLS integration и encrypted restore drill проходят.
3. Production-like MFA E2E подтверждает enrollment, session rotation и повторный login.
4. Stage C gate получает доказательство фактического revoke, а не только config value.
5. Auth secret нельзя заменить обычной release-командой.

## 9. Methodology, limitations, confidence

Использован security-focused differential review относительно `79ec3dc`: инвентаризация всего diff, классификация риска, producer/consumer tracing, `git log`, `git blame`, `git log -S`, анализ удалённых security controls, trust-boundary mapping, blast-radius calculation, test-gap analysis и конкретные attack scenarios.

Проверены все 83 изменённых до отчёта artifacts. HIGH-risk файлы прочитаны углублённо вместе с one-hop dependencies; docs/tests/UI проверены на соответствие инвариантам и наличие доказательств. Анализ library behavior выполнен по установленному pinned Better Auth 1.7.1 code.

Ограничения: не было доступа к фактическому состоянию Cloudflare secrets, Railway roles/grants, production Hyperdrive и provider backup policy; PostgreSQL integration и browser E2E не завершены из-за локальных инфраструктурных блокеров. Поэтому уверенность в статическом findings высокая, а уверенность в фактической production posture — средняя до выполнения smoke/drills.

## Appendix A — Изменённая поверхность

### HIGH-risk: углублённый review

- Auth/MFA/session: `backend/src/auth/better-auth.ts`, `backend/src/auth/http.ts`, `backend/src/auth/rate-limit.ts`, `backend/src/http/rate-limit-actor.ts`, `backend/src/index.ts`, `backend/src/http/types.ts`, `packages/contracts/src/index.ts`.
- DB authorization/schema: `backend/src/db/client.ts`, `backend/src/db/schema.ts`, migrations `backend/drizzle/0015*`–`0025*`, snapshots и `_journal.json`, integration DB tests.
- Admin/secrets: `backend/src/admin/accounts.ts`, `admin-reset-password.ts`, `admin-reset-mfa.ts`, `admin-create-user.ts`, `admin-common.ts` one-hop dependency.
- Release/Cloudflare: `wrangler.jsonc`, `scripts/release-config.mjs`, `release-deploy.mjs`, `release-verify.mjs`, Hyperdrive smoke/revoke/provision scripts и tests.
- Backup/recovery: `backup-crypto.ts`, `backup-dump.ts`, `backup-verify.ts`, `backup.test.ts`, `docs/backup-recovery.md`.
- Frontend auth boundary: `webapp/src/api/mfa.ts`, `api/first-run.ts`, `pages/first-run.tsx`, `components/first-run-forms.tsx`, `router.tsx`, `main.tsx`, `lib/session-boundary.ts`, production E2E/TOTP.

### MEDIUM/LOW-risk: surface + coupling review

- Middleware/logging/static policy: `backend/src/http/middleware.ts`, `http/errors.ts`, `security/pseudonym.ts`, `webapp/public/_headers`, `vite.config.ts`.
- Onboarding/demo/settings shell: `backend/src/onboarding/http.ts`, `onboarding/service.ts`, `demo/http.ts`, `webapp/src/components/app-shell.tsx`, `settings-page.tsx`, `lib/i18n.ts`.
- Test runners/safety: `run-production-e2e.ts`, `run-system-e2e.ts`, `production-e2e-guard.ts`, unit tests, package scripts.
- Documentation/config: `.dev.vars.example`, `.prettierignore`, `README.md`, `PRD.md`, `TASKS.md`, `DESIGN.md`, `docs/production-release.md`, workspace package files и audit allowlist.

## Appendix B — Не включено в findings

- Index `auth_two_factor_secret_idx` индексирует ciphertext, а не plaintext TOTP secret; установленный Better Auth шифрует значение до записи.
- Отсутствие `sessionId` в request context не является найденным bypass: consumers этого поля в текущем коде отсутствуют, server-side session validation остаётся в Better Auth.
- Memory fallback для authenticated reads является осознанным degraded mode; mutations и MFA/login fail-closed при production bindings. Его capacity/abuse тестирование остаётся полезным, но отдельный подтверждённый bypass не найден.
- Stage A с одинаковыми Hyperdrive IDs в текущем `wrangler.jsonc` не является deploy bypass: `release:deploy` требует Stage C и разные IDs. Риск F-03 относится к недоказанному фактическому revoke после перехода в C.
