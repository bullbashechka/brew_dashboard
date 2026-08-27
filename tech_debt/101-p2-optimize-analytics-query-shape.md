# P2 (Stage 2) — Измерить и оптимизировать analytics query shape

**Размер:** L  
**Go/no-go:** отдельное решение после задач 001–009 и production-like измерений  
**Primary signal:** нарушенный PRD budget/Worker resource threshold восстановлен при доказанной эквивалентности данных.

## Наблюдение, не автоматический дефект

`backend/src/analytics/service.ts:415-608` последовательными запросами загружает network, locations, categories, products, orders+items, inventory items/balances/movements и goal в memory snapshot. `trend` (`:310-380`) фильтрует orders для каждого bucket, `productFinancial` (`:279-295`) — для каждого product. HTTP sales/inventory pagination после snapshot выполняется в памяти (`backend/src/analytics/http.ts:278-359`, `:375-434`).

При PRD demo limit до 3000 orders это может быть полностью приемлемо. Оптимизация без baseline способна усложнить timezone/decimal/cursor correctness и дать нулевую пользовательскую пользу.

## Условие старта

На representative dataset зафиксировано хотя бы одно:

- PRD p95 first-screen/filter budget нарушен;
- Worker CPU/memory/response size приближается к platform limits;
- query rows/time растут неприемлемо с orders/products/period;
- in-memory pagination загружает существенно больше строк, чем возвращает, и это материален в профиле.

Порог и dataset записываются до реализации.

## План измерения

1. Добавить request-level development benchmark: endpoint, period, location, query count, rows/bytes where available, DB time, pure compute time, serialized size, total time.
2. Dataset минимум: PRD max demo, 5x max как safety probe, today/7d/30d/6m, all/single location.
3. Снять query plans только для подтверждённых медленных SQL; не добавлять indexes на глаз.
4. Определить dominant cost: DB rows, repeated JS scans, serialization, transaction hold, duplicate requests.

## Минимальные варианты после измерения

- Один-pass bucket/product/location accumulators вместо повторных `.filter` — если CPU dominant.
- SQL cursor pagination recent orders/movements — если over-fetch dominant.
- SQL aggregation только для stable metrics — если DB transfer dominant; historical sale price/cost и timezone windows сохранить.
- Parallel independent reads допустимы только если transaction/client semantics позволяют и consistency snapshot не ломается.

## Не входит

- Не вводить Redis/cache/materialized views/warehouse по умолчанию.
- Не менять API contract/pagination mode без migration plan.
- Не считать уменьшение строк кода успехом без latency/resource результата.

## Подводные камни

- PostgreSQL timezone truncation должна совпадать с IANA/local calendar logic, особенно DST и half-hour zones.
- Cursor обязан иметь stable tie-breaker и не пропускать/дублировать rows.
- Cancelled orders, historical costs, decimal precision и location fallback warnings — инварианты.
- Query plan локальной пустой DB нерепрезентативен.

## Критерии приёмки

- [ ] Есть before/after benchmark на одном dataset и одинаковом окружении.
- [ ] Изменение адресует dominant cost и укладывается в заранее записанный threshold.
- [ ] Contract/integration/property cases подтверждают финансовую и timezone эквивалентность.
- [ ] Нет нового инфраструктурного компонента без отдельного решения.
- [ ] Complexity cost и rollback path задокументированы.

