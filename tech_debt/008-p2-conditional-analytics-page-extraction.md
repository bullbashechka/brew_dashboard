# P2 (conditional) — Извлекать read-only analytics sections только по реальному триггеру

**Stage:** 1, opportunistic  
**Размер:** Conditional, не отдельный обязательный PR  
**Зависимости:** конкретное повторное изменение/reuse/lazy-boundary need  
**Primary signal:** извлечение решает измеримую changeability/test/bundle проблему, а не уменьшает line count.

## Переоценённая проблема

`sales-page.tsx` (561 строк), `overview-page.tsx` (458) и `locations-page.tsx` (314) велики, но их coordinators уже локально ясны:

- Sales query/composition boundary — `sales-page.tsx:39-103`;
- Overview — `overview-page.tsx:49-165`;
- Locations — `locations-page.tsx:38-148`.

Остальная длина в основном образована co-located presentation functions. Простое перемещение `Trend`, `Heatmap`, `LocationCard` или `AlertsList` в соседние файлы не уменьшает runtime coupling и не создаёт ценность автоматически.

## Триггеры выполнения

Извлекать конкретную секцию только если выполняется хотя бы одно:

- секция второй раз существенно меняется независимо от page;
- появился реальный reuse на другой route;
- section требует собственной lazy boundary и build trace доказывает выигрыш;
- owner-local test невозможно сделать устойчивым из-за module-level dependency, а extraction это упрощает;
- merge conflicts по этой секции повторились и зафиксированы.

Без триггера задача закрывается как **defer/no change**.

## Минимальный порядок при триггере

1. Назвать конкретный pain и acceptance до перемещения.
2. Добавить owner-local characterization только для затронутой секции/page state.
3. Извлечь одну секцию с data-down/callback-up props, без самостоятельного query.
4. Не менять markup/classnames/visual copy в structural diff.
5. Проверить responsive behavior и существующую lazy Recharts boundary.

## Не входит

- Не раскладывать все три страницы по папкам одним PR.
- Не создавать dashboard widget registry/base chart/card framework.
- Не переносить query hooks внутрь sections.
- Не унифицировать desktop/mobile DOM любой ценой.

## Подводные камни

- Recharts должен оставаться deferred; extraction может случайно втянуть chart dependency в initial chunk.
- Zero metric и empty state различаются.
- Props surface шире исходных локальных variables может увеличить coupling; если нужен «весь page data object», extraction, вероятно, не окупается.

## Критерии приёмки

- [ ] В задаче/PR указан один подтверждённый trigger и ожидаемый результат.
- [ ] Извлечена минимальная секция, а не создана новая UI architecture.
- [ ] Query lifecycle остаётся у page coordinator.
- [ ] Component/E2E behavior и build chunking не регрессировали.
- [ ] При отсутствии trigger код не меняется.

