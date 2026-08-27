# P1 — Централизовать typed query keys и mutation cache policy

**Stage:** 1  
**Размер:** S  
**Зависимости:** нет; mutation characterization добавляется в 007a–007c  
**Primary signal:** ни одна mutation не инвалидирует tenant cache через вручную собранный строковый массив.

## Проблема

Query definitions используют inline keys в `webapp/src/api/analytics.ts:38-129`, а consumers повторяют частичные prefixes в `inventory-page.tsx:66-100`, `products-page.tsx:57-68`, `settings-page.tsx:107` и `lib/reset-demo.ts:21-23`. Переименование section или изменение формы filters может оставить mutation формально успешной, но UI — stale.

## Цель

Ввести один небольшой typed factory для tenant analytics keys и явные invalidation sets для существующих mutations. Не строить cache framework.

## Предлагаемая минимальная форма

- `analyticsKeys.tenant(networkId)`
- `.locationOptions(networkId)`
- `.overview(networkId)` / `.overviewDetail(networkId, filters)`
- `.locations(networkId)` / detail
- `.sales(networkId)` / detail
- `.products(networkId)` / detail
- `.inventory(networkId)` / detail

Root/prefix keys должны быть `as const`; query option factories используют только detail keys. Mutation code использует owner-provided prefix или маленькую domain policy (`invalidateAfterPriceUpdate`, `invalidateAfterInventoryMovement`) с явно перечисленными affected views.

## TDD-порядок

1. Зафиксировать unit tests точной иерархии keys и tenant separation.
2. В этой задаче добавить минимальные cache-policy tests для price/inventory/goal/reset и tenant separation; owner-tests 007a–007c затем расширяют их пользовательскими recovery assertions.
3. Перевести query definitions, затем mutation invalidations по одной.
4. Удалить оставшиеся `queryKey: ["tenant", ...]` вне factory через `rg`-проверку.

## Подводные камни

- Price update влияет не только Products: current margin/overview могут использовать current product cost/price в отдельных views; invalidation set сверить с контрактом, не угадывать.
- Inventory movement влияет Inventory и alert summary/Overview.
- Reset должен инвалидировать весь tenant root, но session profile обновляется отдельно и не должен случайно очищаться.
- Filters object должен быть canonical/stable по полям; не добавлять сериализатор без фактической проблемы.

## Критерии приёмки

- [ ] Все analytics query options и invalidations используют один factory.
- [ ] Tenant A invalidation не затрагивает tenant B в tests.
- [ ] Price/inventory/goal/reset policies перечислены явно и защищены component tests.
- [ ] Нет общего `invalidateQueries()` для обычной mutation и нет новой абстракции поверх QueryClient.
- [ ] Public UI behavior и API requests не изменились.
- [ ] Локальный invariant check/`rg` не допускает новые raw tenant keys вне factory; отдельная Stage 2 fitness-задача для этого не нужна.

## Проверка

```bash
rg -n 'queryKey: \["tenant"' webapp/src
bun run --cwd webapp test
bun run typecheck
bun run lint
```

Ожидаемый `rg` result — только implementation factory/tests, не consumers.
