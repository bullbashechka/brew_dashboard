# P2 (Stage 2) — Убрать дублирующую загрузку Overview ради alerts

**Размер:** M–L  
**Go/no-go:** после 101 measurement; выполнять только при материальной доле лишних запросов  
**Primary signal:** навигация по non-Overview страницам не строит полный лишний snapshot, а alert semantics остаются едиными.

## Наблюдение

`AppShell` всегда вызывает `overviewQuery` ради notification bell (`app-shell.tsx:76-79`). Overview page вызывает тот же query со своими filters (`overview-page.tsx:49-56`), а Settings запрашивает Overview с `today` ради goal (`settings-page.tsx:51-54`). TanStack Query дедуплицирует только полностью одинаковые keys/filters; на других страницах полный Overview payload может загружаться дополнительно к endpoint страницы.

## Условие старта

Network/server profiling показывает, что shell Overview request реально дублируется и заметно влияет на p95, Worker CPU/DB rows или transfer. Если cache hit/staleTime делает влияние несущественным, задачу закрыть как no-op с evidence.

## Минимальный дизайн при подтверждении

1. Уточнить потребности: shell нужны count/severity/latest alerts; Settings нужен current goal; Overview нужен полный dashboard.
2. Выбрать минимальную границу: компактный `/api/v1/alerts/summary` и/или отдельный goal query. Не создавать универсальный BFF graph endpoint.
3. Добавить shared Zod contract, backend builder и typed query keys.
4. Сохранить одни правила вычисления alerts; summary и Overview вызывают общий pure calculator/SQL owner, а не копируют thresholds.
5. Обновить mutation invalidations через task 005 policy.

## Подводные камни

- Alert count зависит от location/period semantics; header behavior надо явно определить и не менять молча.
- Новый endpoint может увеличить общее число запросов при плохой cache policy. Measure after.
- Inventory movement должна обновлять bell без full page reload.
- Нельзя доверять client-side recomputation из частичных данных.

## Критерии приёмки

- [ ] Before/after trace доказывает уменьшение material cost.
- [ ] Overview, header и Settings используют единого владельца alert/goal semantics.
- [ ] Cache invalidation после inventory/goal/reset покрыта tests.
- [ ] Contract/tenant boundaries сохранены.
- [ ] Если выигрыш не доказан, код не меняется, decision record фиксирует no-op.

