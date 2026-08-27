# P1 — Выделить Products price editor

**Stage:** 1  
**Размер:** S–M  
**Зависимости:** 005; characterization является первым шагом этой задачи  
**Primary signal:** price dialog/mutation/cache lifecycle отделён от analytics presentation и сохраняет historical/current semantics.

## Проблема

`webapp/src/components/products-page.tsx` — 521 строк. `:41-140` связывает analytics query, selected product/dialog state, price mutation, error handling и cache invalidation; `:142-521` содержит menu matrix, categories, cards и details. При изменении editor легко затронуть read-only analytics tree.

## Цель

Выделить `useProductPriceEditor`/`ProductPriceDialog` boundary: controller владеет selected product, form submission, pending/error/success и invalidation; domain views получают только `onEdit`.

## TDD-порядок

1. Зафиксировать open/cancel/success, validation, API error и повторное открытие для другого product.
2. Зафиксировать cache policy: affected Products/current metrics обновляются, tenant B не затрагивается.
3. E2E доказать, что current price меняется, а historical sales price/cost/margin остаются snapshot-at-sale.
4. Извлечь controller/dialog, не перемещая matrix/cards без необходимости.

## Не входит

- Не рефакторить все Product visual sections — только editor boundary.
- Не вводить generic form/mutation hook.
- Не менять price contract, rounding/decimal или historical calculations.

## Подводные камни

- Decimal input нельзя нормализовать через JS float.
- Closing/reopening dialog не должен показывать stale error/draft другого product.
- Price mutation не должна переписывать historical order items даже через optimistic cache transform.
- Invalidation set должен следовать 005, а не широкому `invalidateQueries()`.

## Критерии приёмки

- [ ] Editor/controller имеет direct tests на lifecycle и errors.
- [ ] Read-only matrix/cards не импортируют QueryClient/mutation API.
- [ ] Historical/current semantics подтверждены component + E2E assertion.
- [ ] Tenant-scoped cache policy применяется из единого factory.
- [ ] Visual/accessibility behavior dialog не изменилось.

## Проверка

```bash
bun run --cwd webapp test
bun run test:e2e
bun run typecheck
bun run lint
```

