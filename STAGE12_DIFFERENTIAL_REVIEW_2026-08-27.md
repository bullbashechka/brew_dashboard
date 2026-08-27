# Differential security review — Stage 12

**Дата:** 2026-08-27  
**Базовая версия:** `63c9554` (`Implement Stage 11 settings, feedback, events, and reset`)  
**Диапазон:** незакоммиченные tracked и untracked изменения поверх `63c9554`  
**Стратегия:** FOCUSED для среднего репозитория (177 файлов), с полным разбором HIGH-risk поверхностей и 1-hop зависимостей  
**Рекомендация:** **REJECT до устранения F-01 и восстановления исполнимого release gate из F-03**

## 1. Executive Summary

| Severity | Count |
|---|---:|
| 🔴 CRITICAL | 0 |
| 🟠 HIGH | 1 |
| 🟡 MEDIUM | 3 |
| 🟢 LOW | 0 |

**Overall Risk:** HIGH  
**Recommendation:** REJECT  
**Confidence:** HIGH для проанализированного кода и локальных вторичных проверок; MEDIUM для полной release-готовности, так как PostgreSQL integration и Playwright journeys не исполнялись.

**Ключевые метрики:**

- Проанализировано файлов: 58/58 (37 tracked, 21 untracked).
- Изменение tracked-кода: `+452/-261`; новые файлы: около 3 759 строк, из них 2 412 — сгенерированный Drizzle snapshot.
- HIGH-risk поверхности: authentication/observability, secret scanning, destructive test runners, global retention cleanup, Worker configuration.
- Blast radius observability: все 20 OpenAPI routes плюс unmatched API paths.
- Новых test/spec файлов: 7; integration и browser suites в текущем окружении заблокированы внешними зависимостями.
- Удалённых access-control/tenant checks или security-fix regression по истории не найдено.

## 2. Что изменилось

| Группа | Основные файлы | Риск | Blast radius |
|---|---|---|---|
| Security/release gates | `scripts/audit.mjs`, `scripts/security-scan.mjs`, `.husky/pre-commit`, `package.json` | HIGH | Все release-сборки и коммиты |
| HTTP security/observability | `backend/src/http/middleware.ts`, `backend/src/index.ts`, `backend/src/auth/http.ts`, `wrangler.jsonc`, `webapp/public/_headers` | HIGH | 20 API routes и unmatched paths |
| Destructive test isolation | `backend/scripts/isolated-test-db.ts`, `run-integration.ts`, `run-system-e2e.ts`, `test-safety.ts` | HIGH | Integration/system test cluster |
| Global event retention | `backend/src/events/retention.ts`, admin command, schema и migration `0008` | HIGH | Все `product_events` старше cutoff |
| Domain/performance | demo generator, periods cache, analytics cache, lazy chart | MEDIUM | Analytics и deterministic fixtures |
| Tests/UI/docs | Playwright, component/unit tests, contrast states, README/PRD/TASKS | LOW | Пользовательские и release-сигналы |

**Timeline:** base commit создан 2026-08-26; рабочее дерево относится к Stage 12 от 2026-08-27. Изменения ещё не имеют commit hash, поэтому findings привязаны к `working tree over 63c9554`.

## 3. Findings

### F-01 — 🟠 HIGH: auth-secret попадает в Worker build artifact и обходится обоими release-сканерами

**Файлы:**

- `scripts/check-client-bundle.mjs:L5-L40` (baseline, commit `df3590c`)
- `scripts/security-scan.mjs:L17-L45` (working tree)
- `scripts/audit.mjs:L39-L42` (working tree)
- `package.json:L17` (working tree)
- generated artifact: `webapp/dist/brew_dashboard/.dev.vars`

**Blast Radius:** CRITICAL — центральный `build`/`audit` gate для любого release artifact.  
**Test Coverage:** NO — тестов на generated/ignored artifacts и на generic `BETTER_AUTH_SECRET` нет.  
**Exploitability:** MEDIUM — нужен доступ к архиву сборки, CI cache/artifact или переданному каталогу `webapp/dist`.

#### Описание

`bun run build` создаёт `webapp/dist/brew_dashboard/.dev.vars`. Локальная проверка без чтения или вывода значения установила, что файл содержит непустой `BETTER_AUTH_SECRET`; build output также явно перечисляет `.dev.vars` внутри Worker artifact.

После этого обе проверки возвращают success:

- `check-client-bundle.mjs` рекурсивно читает только `webapp/dist/client`, поэтому Worker artifact вне scope;
- fallback в `security-scan.mjs` использует `git ls-files --cached --others --exclude-standard`, а `webapp/dist` исключён правилом `.gitignore:5`;
- установленного `gitleaks` нет, поэтому `bun run audit` выполняет именно этот fallback и завершился с exit 0.

Иными словами, новый Stage 12 gate подтверждает отсутствие secret findings, хотя в generated artifact уже присутствует authentication secret.

#### Historical Context

Cloudflare/Vite build и client-only checker существовали в baseline (`df3590c`/`e5b2ff9`). Текущий diff не создал первичное копирование `.dev.vars`, но добавил security scanner, release gate и утверждение о завершённом secret review, не покрыв фактический Worker artifact. Это regression обещанного security invariant: «release artifact не содержит server-only secrets».

#### Attacker Model

- **WHO:** пользователь CI artifacts, подрядчик или злоумышленник с доступом к опубликованному/закэшированному каталогу сборки.
- **ACCESS:** чтение `webapp/dist`, без доступа к production database или приложению.
- **INTERFACE:** build archive/cache, содержащий `brew_dashboard/.dev.vars`.

#### Attack Scenario

1. CI или разработчик запускает `bun run build`.
2. В Worker output создаётся `.dev.vars` с непустым `BETTER_AUTH_SECRET`.
3. `bun run audit` и `check:client-secrets` проходят, поэтому artifact считается безопасным.
4. Каталог `webapp/dist` публикуется как CI artifact, передаётся другому участнику или сохраняется в доступном cache.
5. Получатель читает auth secret. Если этот secret совпадает с используемым доверенным секретом среды, нарушается целостность/конфиденциальность auth/session artifacts; требуется немедленная ротация и инвалидирование сессий.

**Concrete Impact:** утечка server-only authentication secret из артефакта, который текущий release gate помечает безопасным. Внешняя эксплуатация не подтверждена, поскольку политика публикации artifacts и production value не анализировались.

#### Рекомендация

1. Не копировать `.dev.vars` в production build output либо удалять его в owning build configuration до упаковки artifact.
2. Расширить build-time scan на весь `webapp/dist`, включая ignored/generated files, с явным deny-list для server-only variable names.
3. Добавить автоматический тест: после clean build ни один файл под `webapp/dist` не содержит `BETTER_AUTH_SECRET` и другие запрещённые markers.
4. Не публиковать текущий `webapp/dist`; если artifact уже покидал доверенную машину, считать secret скомпрометированным и ротировать его.

### F-02 — 🟡 MEDIUM: persisted observability пишет attacker-controlled raw paths при 100% sampling

**Файлы:**

- `backend/src/http/middleware.ts:L75-L94`
- `backend/src/index.ts:L510-L513`, `L643-L659`
- `wrangler.jsonc:L7-L19`

**Blast Radius:** CRITICAL — все 20 OpenAPI routes и любое unmatched `/api/*`.  
**Test Coverage:** PARTIAL — health-path и отсутствие body проверяются, но redaction/cardinality неизвестных и parameterized paths не проверяются.  
**Exploitability:** EASY — публичный HTTP access без аутентификации.

#### Описание

Поле `route` всегда получает `context.req.path`, то есть raw request path. Для совпавшего parameterized route отдельно добавляется `routePattern`, но raw значение остаётся в persisted log. Для unmatched route `routePattern` сводится к wildcard, однако `route` продолжает содержать произвольную строку пользователя.

Одновременно Worker включает persisted invocation logs с `head_sampling_rate: 1`. Глобального rate limit для 404/unknown routes в анализируемом пути нет.

#### Attack Scenario

1. Неаутентифицированный пользователь отправляет большое количество `GET /api/v1/<unique-random-value>`.
2. Каждый запрос завершается 404 и создаёт warn-level `http_request_completed.v1` с уникальным raw `route`.
3. Persisted logging принимает 100% записей; cardinality и объём логов растут пропорционально запросам.
4. Полезные security signals вытесняются шумом, а ingestion/storage cost и сложность запросов растут. На authenticated parameterized routes в лог также попадают resource IDs.

**Concrete Impact:** дешёвое log-flooding и неконтролируемая cardinality; возможное сохранение resource identifiers сверх заявленного набора safe account identifiers.

#### Рекомендация

- Использовать matched route pattern как основное `route`; для unmatched requests писать фиксированное значение вроде `unmatched`.
- Не сохранять raw path либо применять строгую allow-list/redaction и отдельный sampling.
- Добавить тесты для random 404 path и `/products/:productId/price`, подтверждающие отсутствие пользовательских segments в persisted payload.
- Пересмотреть 100% persisted sampling для публичных 4xx.

### F-03 — 🟡 MEDIUM: `validate:stage12` не передаёт обязательный database URL в system E2E

**Файлы:**

- `package.json:L17`, `L26-L28`
- `backend/scripts/run-system-e2e.ts:L10-L16`
- `README.md:L92-L99`

**Blast Radius:** HIGH — единственный заявленный полный Stage 12 release gate.  
**Test Coverage:** NO — clean-environment invocation самого root gate не проверяется.

#### Описание

`test:integration:docker` задаёт `DATABASE_TEST_ADMIN_URL=...` только для вложенного `bun run test:integration`. Shell assignment не экспортируется в последующие команды `&&`. Затем `validate:stage12` вызывает `test:e2e:system`, чей runner fail-closed требует `DATABASE_TEST_ADMIN_URL`, но соответствующий root script его не задаёт.

В текущем clean environment точечный запуск завершился exit 1 до старта Worker:

```text
error: DATABASE_TEST_ADMIN_URL is required for system E2E
Error: Process from config.webServer was not able to start. Exit code: 1
```

Команда может пройти только если вызывающий пользователь заранее экспортировал переменную, что противоречит формулировке README о полном gate «одной командой» и не закреплено самим script.

#### Impact

Release gate либо всегда красный в чистом окружении, либо зависит от скрытого ambient state. Это создаёт стимул пропускать system E2E, содержащий единственную browser-проверку реального Worker, tenant read/write isolation и performance budgets.

#### Рекомендация

- Добавить root system-E2E wrapper, который поднимает/переиспользует локальный test PostgreSQL и явно передаёт тот же loopback admin URL.
- Сделать `validate:stage12` воспроизводимым без предварительного `export`.
- Добавить smoke-проверку чистого окружения для orchestration script и оставить fail-closed guards внутри runner.

### F-04 — 🟡 MEDIUM: «bounded batches» retention выполняются внутри одной неограниченной транзакции

**Файлы:**

- `backend/src/events/retention.ts:L93-L134`
- `backend/scripts/admin-cleanup-events.ts:L9-L34`
- `README.md:L108-L117`

**Blast Radius:** HIGH по данным — все `product_events` старше cutoff; LOW по callers — один admin entry point.  
**Test Coverage:** PARTIAL — unit validation прошла; integration test использует только две удаляемые строки и в текущем окружении не запускался.  
**Exploitability:** HARD — требуется production admin access и двойное подтверждение для remote database.

#### Описание

Каждый `DELETE` ограничен 500 строками, но весь `while` находится внутри одного `db.transaction`. Поэтому transaction lifetime, удерживаемые до commit row versions/locks, WAL и rollback scope растут до полного числа candidates. Это не обеспечивает операционную границу, которую обычно подразумевает «batch cleanup».

Дополнительно `pg_total_relation_size` измеряется до commit в той же транзакции. Обычный `DELETE` не уменьшает физический relation size до последующего обслуживания, поэтому `after.relationBytes` не доказывает высвобождение storage budget.

#### Failure Scenario

1. Администратор видит большой dry-run count и запускает `--execute`.
2. Command удаляет все candidates серией по 500, но не commit-ит между сериями.
3. Долгая транзакция накапливает WAL/dead tuples и может конфликтовать с обслуживанием/репликацией; прерывание откатывает весь прогресс.
4. Финальный relation size может остаться прежним, хотя report визуально предлагает before/after storage comparison.

#### Рекомендация

- Commit-ить каждую batch отдельной транзакцией и возвращать cumulative aggregate без event IDs.
- Добавить максимальный total rows/runtime, `lock_timeout`/`statement_timeout` и безопасное resume поведение.
- Отделить logical row count от physical storage metric и документировать vacuum/compaction semantics.
- Добавить integration test на несколько batches и interruption/resume; проверить concurrency с event ingestion.

## 4. Test Coverage Analysis

| Поверхность | Покрытие | Оценка |
|---|---|---|
| Security headers | Unit test на API health | PARTIAL: asset delivery/production HTTPS не исполнялись |
| Observability payload | Unit test на health и signal helpers | PARTIAL: нет 500, parameterized/unmatched path и cardinality cases |
| Auth safe identifiers | Косвенно через существующие auth tests | PARTIAL: нет успешного login/me log assertion |
| Secret scanning | Нет тестов | NO |
| Release orchestration | Ручной отрицательный запуск clean system E2E | FAILS без ambient env |
| Test DB guards | Unit guard + static path tracing | PARTIAL: Docker suite не запускалась |
| Tenant isolation | Новый real system journey | NOT RUN: Chromium и PostgreSQL недоступны |
| Retention | Unit + integration test source | PARTIAL: integration не запускалась; large-batch отсутствует |
| Domain/cache/UI | Unit/component suite | PASS |

**Локально выполнено:** 90 unit/component/contract tests, 0 failures. Это не закрывает primary security signals tenant isolation, real Worker browser flow и production-like retention.

## 5. Blast Radius Analysis

| Изменение | Callers / routes | Risk | Priority |
|---|---:|---|---|
| Build/audit secret guarantee | 1 central release pipeline, все artifacts | HIGH | P0 |
| `observabilityMiddleware` | 20 OpenAPI routes + unmatched API | MEDIUM | P1 |
| `safeAccount` propagation | login + все authenticated paths | HIGH surface, finding не выявлен | P1 reviewed |
| `cleanupProductEvents` | 1 admin caller, global table scope | MEDIUM | P1 |
| `createIsolatedTestDatabase` | integration + system E2E runners | HIGH destructive surface, guards preserved | P1 reviewed |
| `localDateTimeToUtc` cache | analytics + demo generator | MEDIUM | P2 |
| Analytics query caching | 6 UI consumers | LOW | P3 |

## 6. Historical Context and Regression Checks

- Git history просмотрена до Stage 2/3 auth и tenant-hardening commits (`c21d75b`, `5c5ef4f`, `4f8d5a1`).
- Удалённая логика `run-integration.ts` не исчезла: loopback assertion, isolated database, runtime role creation и cleanup перенесены в `isolated-test-db.ts`; дополнительно появился fail-closed `E2E_ACCOUNT_KIND=e2e` guard.
- Удалённых authorization modifiers, origin checks, body limits, tenant predicates или validation без замены не найдено.
- Изменение auth добавляет только safe-account context после подтверждённого profile/session и не принимает `networkId` от клиента.
- Новая migration добавляет индекс `product_events_occurred_idx`; applied migrations не редактировались. `drizzle-kit check` прошёл.
- F-01 — не повторное добавление ранее удалённой уязвимости, а незакрытый baseline artifact leak, который новый Stage 12 scanner ошибочно считает покрытым.

## 7. Recommendations

### Immediate — blocking

- [ ] Удалить server secrets из generated Worker artifact и сканировать весь `webapp/dist`.
- [ ] Проверить, публиковался ли текущий artifact; при любом внешнем доступе ротировать `BETTER_AUTH_SECRET`.
- [ ] Сделать `validate:stage12` воспроизводимым и передать loopback `DATABASE_TEST_ADMIN_URL` в system E2E.

### Before production

- [ ] Нормализовать observability route до route pattern/unmatched и ограничить 4xx log cardinality.
- [ ] Переделать retention на commit-per-batch с total/runtime limits.
- [ ] Запустить `test:integration:docker`, mocked Playwright и system Playwright на обоих проектах.
- [ ] После исправления повторить build и доказать отсутствие `.dev.vars`/server secret markers во всём artifact tree.

### Technical debt / follow-up

- [ ] Добавить tests для security scanner false negatives и generated ignored files.
- [ ] Добавить observability tests для 500, 404 flood, parameterized routes и safe identifiers.
- [ ] Отделить logical retention count от physical storage/vacuum reporting.

## 8. Выполненные проверки

| Команда/проверка | Результат |
|---|---|
| `bun run lint` | PASS |
| `bun run typecheck` | PASS |
| `bun run test` | PASS: 16 contracts + 36 backend + 38 webapp tests |
| `bun run build` | PASS, но выявлен F-01: generated Worker `.dev.vars` |
| `bun run audit` | PASS с 1 moderate `esbuild`; fallback проверил 212 tracked/untracked файлов, но пропустил F-01 |
| `bun run db:check` | PASS |
| `git diff --check` | PASS |
| clean-env `bun run test:e2e:system ...` | FAIL: отсутствует `DATABASE_TEST_ADMIN_URL` |
| `docker info` | BLOCKED: Docker daemon socket отсутствует |
| Playwright Chromium executable check | BLOCKED: Chromium и headless shell отсутствуют |

## 9. Analysis Methodology

**Coverage:**

- Все 58 changed/new files классифицированы и просмотрены.
- Все HIGH-risk production/scripts/config surfaces разобраны line-by-line с caller tracing.
- Сгенерированный `backend/drizzle/meta/0008_snapshot.json` не проверялся вручную построчно; согласованность schema/migration подтверждена `drizzle-kit check`.
- Removed security-related code проверено через diff search, `git log -S` и `git blame` baseline.
- Adversarial modeling применён к F-01, F-02 и admin failure path F-04.

**Ограничения:**

- Нет работающего Docker daemon, поэтому PostgreSQL integration, RLS/tenant и retention execution не подтверждены runtime-сигналом.
- Нет установленного Playwright Chromium, поэтому desktop/mobile accessibility, performance и real Worker journeys не исполнялись.
- Значения secrets намеренно не читались и не включались в отчёт; проверялись только наличие key marker, непустота и расположение artifact.
- Не анализировалась внешняя политика CI artifact retention/access, поэтому факт внешней компрометации F-01 не утверждается.
- External dependency internals не аудитились; использовались lockfile, локальный build и `bun audit`.

## Appendix A — Changed File Inventory

**HIGH/MEDIUM production and operations:**

`package.json`, `bun.lock`, `wrangler.jsonc`, `.husky/pre-commit`, `scripts/audit.mjs`, `scripts/security-scan.mjs`, `scripts/system-e2e-fixture.ts`, `backend/package.json`, `backend/scripts/run-integration.ts`, `backend/scripts/admin-cleanup-events.ts`, `backend/scripts/isolated-test-db.ts`, `backend/scripts/run-system-e2e.ts`, `backend/scripts/test-safety.ts`, `backend/src/auth/http.ts`, `backend/src/http/middleware.ts`, `backend/src/http/types.ts`, `backend/src/index.ts`, `backend/src/events/retention.ts`, `backend/src/db/schema.ts`, `backend/src/domain/demo-generator.ts`, `backend/src/domain/periods.ts`, `backend/drizzle/0008_serious_angel.sql`, `backend/drizzle/meta/_journal.json`, `backend/drizzle/meta/0008_snapshot.json`, `webapp/playwright.config.ts`, `webapp/src/api/analytics.ts`, `webapp/src/pages/overview.lazy.tsx`, `webapp/src/components/overview-trend-chart.tsx`, `webapp/public/_headers`.

**Tests and low-risk UI/docs:**

`PRD.md`, `README.md`, `TASKS.md`, `backend/tests/integration/onboarding.integration.test.ts`, `backend/tests/integration/retention.integration.test.ts`, `backend/tests/unit/stage3.test.ts`, `backend/tests/unit/stage4.test.ts`, `backend/tests/unit/retention.test.ts`, `webapp/package.json`, `webapp/e2e/accessibility.spec.ts`, `webapp/e2e/analytics.spec.ts`, `webapp/e2e/first-run.spec.ts`, `webapp/e2e/fixtures.ts`, `webapp/e2e/foundation.spec.ts`, `webapp/e2e/inventory.spec.ts`, `webapp/e2e/performance.spec.ts`, `webapp/e2e/sales-products.spec.ts`, `webapp/e2e/settings.spec.ts`, `webapp/e2e/system.spec.ts`, `webapp/src/components/feedback.tsx`, `webapp/src/components/ui/states.tsx`, `webapp/src/pages/inventory.lazy.tsx`, `webapp/src/pages/locations.lazy.tsx`, `webapp/src/pages/products.lazy.tsx`, `webapp/src/pages/sales.lazy.tsx`, `webapp/src/pages/settings.lazy.tsx`, `webapp/tests/unit/analytics-format.test.ts`, `webapp/tests/unit/reset-demo-dialog.test.tsx`, `webapp/tests/unit/states.test.tsx`.
