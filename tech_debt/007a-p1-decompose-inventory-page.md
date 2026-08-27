# P1 — Выделить Inventory mutation/recovery controller

**Stage:** 1  
**Размер:** M  
**Зависимости:** 005; characterization является первым шагом этой задачи  
**Primary signal:** receipt/writeoff/conflict/retry/filter recovery тестируются без крупного visual tree.

## Проблема

`webapp/src/components/inventory-page.tsx` — 539 строк. `:37-236` одновременно владеет infinite query, movement draft, mutation, conflict snapshot, refresh/retry, multiple invalidations и page states; `:238-539` содержит balances, actions, movements и responsive UI. Эта связка делает опасными изменения concurrency/recovery.

## Цель

Выделить domain controller `useInventoryMovement` (точное имя не обязательно), который владеет draft/submit/conflict/refresh/retry и возвращает явную state machine для page. Presentation получает data/status/callbacks и не знает QueryClient.

## TDD-порядок

1. На существующем fetch/QueryClient boundary зафиксировать: receipt, writeoff, pending/disabled, validation, 409 stale revision, сохранение draft, refresh и успешный retry.
2. Отдельно зафиксировать случай, когда active status filter после refresh скрывает balance: recovery form остаётся доступной.
3. Перевести invalidations на `analyticsKeys`/policy из 005.
4. Извлечь controller без изменения markup; затем передать его результат существующим Balances/RecentMovements sections.
5. Прогнать desktop/mobile inventory Playwright.

## Не входит

- Не создавать generic mutation/reducer framework.
- Не менять backend conflict contract, optimistic semantics, copy или layout.
- Не объединять inventory form с product/goal mutations.

## Подводные камни

- 409 recovery должен использовать свежую revision, но не терять пользовательский quantity/type.
- Receipt/writeoff имеют разные sign/business validation; controller не должен свести их к небезопасному числу.
- Inventory mutation обновляет Inventory и Overview/alerts согласно явной cache policy.
- Infinite pages после mutation нельзя склеивать со stale cursors.

## Критерии приёмки

- [ ] Controller имеет direct behavior tests на success/validation/conflict/retry/filter recovery.
- [ ] Presentation sections не импортируют QueryClient/API mutation.
- [ ] Draft и fresh revision корректно переживают 409.
- [ ] Cache invalidation tenant-scoped и покрыта test.
- [ ] Full inventory E2E green desktop/mobile.

## Проверка

```bash
bun run --cwd webapp test
bun run test:e2e
bun run typecheck
bun run lint
```

