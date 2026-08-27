# P1 — Закрыть только реальные общие backend test gaps

**Stage:** 1  
**Размер:** S–M  
**Зависимости:** выполнить после 002 и переоценить после 009/011/013  
**Primary signal:** оставшиеся общие orchestration-инварианты имеют устойчивый test owner; integration behavior не дублируется ради coverage.

## Уточнённая проблема

Низкий fast coverage отдельных service/http-файлов сам по себе не является P0. Существенные DB-bound инварианты уже проверяются integration suite:

- location fallback, analytics contracts и cursor — `backend/tests/integration/analytics.integration.test.ts:127-225`;
- inventory tenant/idempotency/conflict — `analytics.integration.test.ts:302-430`;
- transactional rollback — `analytics.integration.test.ts:516-579`;
- onboarding/reset rollback — `backend/tests/integration/onboarding.integration.test.ts:326-454`.

Долг остаётся только там, где owning-refactor не может получить быстрый feedback без повторного поднятия БД либо где общий harness нужен нескольким доменам. Такой gap надо сначала доказать.

## Цель

После owner-задач 009/011/013 составить компактную матрицу «инвариант → существующий test → suite → реальный пробел». Добавить только недостающие tests/helpers. Не повышать общий coverage процент как самостоятельную цель.

## Кандидаты для gap analysis

- pure analytics period/timezone/decimal calculations, извлечённые в 009;
- общая проверка Hono error envelope/requestId и compile-time route compatibility из 011;
- auth cookie clearing/inactive profile behavior, если оно не защищено существующими unit/integration cases;
- failure-injection harness для transaction rollback, только если три и более owners дублируют одну механику;
- предметное переименование `stage3.test.ts`/`stage4.test.ts` при фактическом касании этих tests.

Это кандидаты, не заранее утверждённый объём. Если mapping показывает существующее качественное покрытие, пункт закрывается ссылкой без нового теста.

## Порядок

1. Собрать mapping существующих unit/integration/system tests по public invariants.
2. Вычеркнуть всё уже доказанное на правильном уровне.
3. Добавить owner-local test в 009/011/013, если helper нужен одному домену.
4. В этой задаче оставить только shared test utility или cross-domain error/transaction invariant.
5. Удалить/объединить helper, если он сложнее повторённых test setup блоков.

## Не входит

- Не дублировать SQL/RLS/idempotency integration tests в fake unit DB.
- Не экспортировать private production internals ради coverage.
- Не создавать query-text mocks, универсальный fake database DSL или глобальный threshold.
- Не переименовывать tests отдельным массовым PR: делать это рядом с реальным изменением owner-а.

## Подводные камни

- Pure calculation test и DB mapping test защищают разные риски; один не заменяет другой.
- Failure injection должен падать в контролируемой точке, не зависеть от порядка SQL strings.
- Auth/tenant negative cases обязаны остаться real DB/system tests, если смысл инварианта — RLS.

## Критерии приёмки

- [ ] Есть mapping существующего покрытия и конкретных gaps, а не отчёт только по процентам.
- [ ] Новые tests закрывают gap, который не покрывает integration/system suite.
- [ ] Shared helper имеет минимум несколько реальных consumers и меньше собственной сложности, чем setup.
- [ ] Stage-numbered backend tests переименованы только при касании и сгруппированы по владельцу поведения.
- [ ] Если общих gaps не осталось, задача закрыта evidence-only без code change.

## Проверка

```bash
bun run test
bun run test:integration
bun run typecheck
bun run lint
```

