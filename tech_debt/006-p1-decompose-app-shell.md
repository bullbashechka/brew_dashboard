# P1 — Разделить ответственность AppShell

**Stage:** 1  
**Размер:** M  
**Зависимости:** 005; AppShell characterization является первым шагом этой задачи, helper при повторении — 004  
**Primary signal:** shell сохраняет поведение, а routing/cache/feedback/tour/UI имеют явных локальных владельцев.

## Проблема

`webapp/src/components/app-shell.tsx` — 518 строк. `:51-204` одновременно владеет route/search parsing, profile/feedback/location/overview queries, invalid-location recovery, product events, feedback prompt state, logout, tour persistence и navigation side effects. `:206-518` содержит navigation/header/drawer/filter/alert UI. Изменение одной области требует понимания почти всего authenticated shell.

Это настоящий god-component по количеству обязанностей, но его не нужно заменять framework-ом.

## Цель

Оставить `AppShell` composition root: получить profile/locale, собрать controllers, отрисовать shell и `<Outlet>`. Извлечь только уже существующие обязанности.

## Минимальное разбиение

1. `useAnalyticsSearch` — чтение/canonical update period, location, inventory status, locations sorting.
2. `useFeedbackPrompt` — section/mutation counters, local persistence и open/dismiss state.
3. `useSectionTelemetry` — dispatch `section_viewed`/`filter_changed`, без UI.
4. `AppNavigation` и `AppHeader`/`MobileDrawer` — presentational props, без самостоятельных queries.
5. Tour/persist/logout оставить в shell либо извлечь по одному controller только если tests показывают самостоятельную сложность.

Имена/файлы можно адаптировать к существующей структуре; важны ownership и отсутствие циклов.

## TDD-рефакторинг

1. Сначала добавить owner-local characterization на filter/navigation/logout/feedback/tour; использовать общий helper 004 только если setup уже повторяется.
2. Извлечь чистый `sectionFromPath`/search normalization и покрыть table tests.
3. Извлечь navigation UI без изменения markup/accessibility names.
4. Извлечь feedback/telemetry effects по одному, каждый раз прогоняя узкий suite.
5. Последним упростить shell composition и проверить desktop/mobile Playwright.

## Не входит

- Не менять URL schema, дизайн, route tree или analytics API.
- Не устранять полный Overview request ради alerts — задача 102 после измерений.
- Не создавать context/provider для каждого hook и не вводить global state.
- Не объединять все effects в абстрактный event bus.

## Подводные камни

- Tour должен оставаться mounted при переходах между тремя routes (`app-shell.tsx:88-90`).
- Cleanup timer в feedback effect не должен теряться при early return (`:122-135`); tests должны зафиксировать отсутствие stale timer update.
- Logout обязан cancel/clear queries до navigation (`:148-155`) и не оставлять tenant data.
- Invalid location fallback зависит и от options, и от API warning (`:92-120`); нельзя дублировать решение в hook и page.
- Mobile drawer link click закрывает drawer; сохранить keyboard/focus semantics.

## Критерии приёмки

- [ ] `AppShell` читается как composition root, без вложенных render-функций navigation/header.
- [ ] Каждый extracted controller имеет одну понятную обязанность и direct tests сложных переходов.
- [ ] Нет новых providers/framework abstractions или дублированного route state.
- [ ] URL filters, tour, feedback prompt, telemetry, logout и responsive navigation ведут себя идентично.
- [ ] Full mocked E2E green на desktop/mobile.

## Проверка

```bash
bun run --cwd webapp test
bun run test:e2e
bun run typecheck
bun run lint
bun run build
```
