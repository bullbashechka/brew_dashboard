# P1 — Разделить backend analytics service по ответственности

**Stage:** 1  
**Размер:** M  
**Зависимости:** 002; analytics characterization является первым шагом этой задачи, общие остаточные gaps — 003  
**Primary signal:** те же API contracts и SQL behavior при меньшей связанности loader/calculations/presenters.

## Проблема

`backend/src/analytics/service.ts` содержит 1273 строки и четыре разных вида работы:

- SQL snapshot loading и row mapping (`:415-608`);
- context/filter/window selection (`:611-655`);
- financial/timezone/group calculations (`:158-414`, `:656-923`);
- response builders пяти endpoints (`:933-1273`).

Файл является горячей точкой изменений и плохо покрыт быстрым suite. При этом менять query shape сейчас преждевременно: PRD ограничивает demo до 3000 orders, а production-like bottleneck ещё не измерен.

## Цель

Выполнить механическое, characterization-first разделение без изменения SQL, количества queries, response JSON, sorting/cursor и decimal/timezone semantics.

## Предлагаемая граница

- `analytics/snapshot.ts` — types, `buildSnapshot`, row mapping, database-only code.
- `analytics/context.ts` — period/location/status/sort selection и warning semantics.
- `analytics/calculations.ts` — pure calculations: metrics, trends, group/product financials, alerts.
- `analytics/presenters/<endpoint>.ts` либо компактные доменные builders — Overview/Locations/Sales/Products/Inventory.
- `analytics/service.ts` остаётся стабильным public facade/re-export для handlers на время миграции imports.

Не обязательно создавать каждый указанный файл: если две соседние обязанности малы и меняются вместе, оставить их вместе.

## TDD-рефакторинг

1. Сопоставить существующие integration cases с рисками изменения и добавить только недостающие owner-local pure/mapping tests; не дублировать уже проверенные cursor/RLS/rollback cases.
2. Перенести pure helpers и типы без логических изменений; diff review на accidental export/ordering.
3. Перенести snapshot loader; SQL literals сначала оставить байт-в-байт эквивалентными.
4. Разнести endpoint builders и сохранить public facade.
5. Только после зелёных tests удалить transitional re-exports, если imports понятны и циклов нет.

## Не входит

- Не переносить aggregation/pagination в SQL — задача 101.
- Не добавлять repository interfaces, DI container или generic query builder.
- Не менять public response schemas, database schema/migrations или caching.
- Не заменять Decimal/temporal helpers.

## Подводные камни

- `Snapshot` и `AnalyticsContext` могут превратиться в новый god-object. Exports держать минимальными; presenters получают только нужный context, но без costly копирования.
- Sorting и cursor зависят от deterministic tie-breakers; перемещение не должно поменять order.
- `resolvePeriodWindow` вызывается несколько раз (`:623-638`); можно локально переиспользовать результат, но не менять timezone semantics в структурном PR.
- Исторические price/cost берутся из order items, не current products.
- Invalid `locationId` возвращает fallback warning, а не 404 — сохранить.

## Критерии приёмки

- [ ] Public handler imports и response payloads не изменились либо совместимо мигрированы одним PR.
- [ ] Snapshot SQL/query count и ordering не менялись; это подтверждено integration tests/log snapshot.
- [ ] Pure calculations не импортируют DB/Hono.
- [ ] Endpoint presenters не исполняют SQL напрямую.
- [ ] Нет dependency cycles и generic repository abstraction.
- [ ] Owner-local tests, существующий integration suite и full typecheck зелёные.

## Проверка

```bash
bun run test
bun run test:integration
bun run typecheck
bun run lint
bun run build
```
