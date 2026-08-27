# P0 — Закрыть real DB и tenant-isolation gate

**Stage:** 1  
**Размер:** M  
**Зависимости:** 001 для чистой диагностики Playwright  
**Primary signal:** integration suite и real Worker system journey проходят на изолированной PostgreSQL fixture.

## Проблема

`TASKS.md:436-440` оставляет Stage 12 acceptance незакрытым. Mandatory journeys и tenant negative cases описаны в `PRD.md:812-825`, но текущий локальный E2E запуск пропускает два `system.spec.ts` сценария. Fast unit suites не доказывают реальные PostgreSQL constraints, RLS, transaction-local tenant context, migrations, Hyperdrive-compatible connection lifecycle и rollback/idempotency в совокупности.

Это не означает, что tenant isolation сломана: код и integration tests выглядят осмысленно. Долг — отсутствие воспроизводимого зелёного доказательства перед релизом.

## Цель

Сделать один документированный, изолированный путь запуска реальной БД и локального Worker runtime через Cloudflare Vite plugin, который не использует Railway production data, не зависит от ручных правок `.env` и подтверждает positive/negative user journeys.

## Не входит

- Не поднимать staging-платформу, постоянный hosted CI database или новую deployment-систему.
- Не ослаблять RLS/auth, чтобы тесты стали проще.
- Не добавлять production credentials в repository/CI artifacts.
- Не редактировать применённые migrations.

## Порядок выполнения

1. Проверить существующие root scripts и testcontainers/local PostgreSQL lifecycle; использовать их, а не второй harness.
2. Зафиксировать prerequisite failure ясным preflight: Docker/daemon/port/runtime missing должен завершаться с actionable сообщением до запуска Playwright.
3. Запустить `bun run test:integration` на чистой fixture DB; исправлять только воспроизводимые failures, сохраняя per-test tenant isolation.
4. Запустить opt-in `webapp/e2e/system.spec.ts` через существующий `backend/scripts/run-system-e2e.ts`, который поднимает локальный dev runtime, и против той же схемы данных.
5. Проверить негативные случаи: cross-tenant read/write, client-supplied `network_id`, stale version, idempotent replay, rollback после mid-operation failure.
6. Проверить migration apply с нуля и `bun run db:check`; никаких ручных SQL шагов между командами.
7. Завершить каноническим `bun run validate:stage12` (`package.json:17`), а не набором выборочных proxy checks. Если `db:check` является обязательным Stage 12 invariant, добавить его в canonical script отдельной маленькой правкой.
8. Обновить `TASKS.md:436-447` только после фактического зелёного сигнала и с точными командами/окружением.

## Подводные камни

- Integration и system suites не должны разделять мутированное состояние без явного reset/unique tenant.
- Нельзя подставлять production Railway URL даже read-only: fixture должна быть локальной/изолированной.
- Cloudflare bindings и Hyperdrive semantics могут отличаться от прямого PostgreSQL URL. Тест должен явно документировать, какую часть он проверяет напрямую, а какую — Worker binding.
- Parallel tests и advisory locks могут создавать ложную flaky-картину. Сначала устранить утечку fixture lifecycle, а не переводить всё в serial.

## Критерии приёмки

- [ ] `bun run test:integration` проходит на чистом documented setup.
- [ ] Real system journey проходит end-to-end и не skipped при opt-in environment.
- [ ] `bun run validate:stage12` является финальным зелёным release signal; отдельные команды используются только для диагностики.
- [ ] Cross-tenant reads и writes доказанно отклоняются на уровне реального API/DB.
- [ ] Полная цепочка migrations применяется с нуля; `bun run db:check` проходит.
- [ ] В логах/artifacts нет connection strings, auth secrets, cookies или customer-like data.
- [ ] Отсутствие prerequisite даёт короткое понятное preflight-сообщение, не каскад из десятков failures.

## Проверка

```bash
bun run db:check
bun run test:integration
bun run test:e2e
bun run validate:stage12
```

Если полный запуск невозможен в CI/локально, задача не считается выполненной; нужно отдельно принять решение об инфраструктуре, а не заменять primary signal unit-тестами.
