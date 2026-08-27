# P1 — Собрать минимальный frontend test harness для owning-refactors

**Stage:** 1  
**Размер:** S  
**Зависимости:** 001  
**Primary signal:** owner-задачи быстро тестируют QueryClient/router/fetch behavior без новой testing platform.

## Проблема

Крупные frontend coordinators имеют мало direct component coverage, но переносить все AppShell/pages/mutations в одну «задачу покрытия» слишком широко. В репозитории уже есть рабочий подход: локальный `fetch` mock плюс реальный QueryClient, например `webapp/tests/unit/feedback.test.tsx:29-72`. Нужно переиспользовать его, а characterization добавлять первым шагом конкретных 006/007a–007c.

## Цель

Выделить только повторяемый test setup: свежий QueryClient с deterministic retry/gc, router location/search, profile/network factory и безопасный fetch-response helper, валидируемый shared schemas. Если двух-трёх consumers нет, оставить setup локальным.

## Порядок

1. В 006 создать первый AppShell characterization test с локальным setup.
2. В 007a/007b/007c повторить только необходимую часть и отметить фактическое дублирование.
3. Извлечь минимальный helper только после повторения: `renderWithAppContext`, fresh QueryClient и typed response builder.
4. Сохранить domain-specific routes/payloads рядом с тестом владельца.
5. Проверить tenant cache isolation двумя разными network IDs и отсутствие state leakage между tests.

## Не входит

- Не добавлять MSW по умолчанию: его нет в текущих dependencies, а существующий fetch boundary достаточен. Новая dependency требует отдельного доказанного выигрыша и согласования.
- Не мокать TanStack Query hooks или router implementation.
- Не собирать магический `setupWholeApp()` со всеми endpoints.
- Не дублировать cross-page Playwright journeys в component suite.
- Не вводить общий coverage threshold.

## Подводные камни

- QueryClient очищается после каждого test; retries отключаются/задаются явно.
- Builders возвращают свежие objects и проходят Zod parse, иначе mocks дрейфуют от contracts.
- Fake timers включаются только для контролируемого feedback/tour timer, не глобально на весь suite.
- Assertions проверяют user-visible state/router location/cache result, не внутреннее число hook calls.

## Критерии приёмки

- [ ] Helper появился только для setup, повторённого минимум в нескольких owning tests.
- [ ] Нет новой testing dependency и test-only production exports.
- [ ] Каждый owner сам содержит loading/error/mutation cases, необходимые его refactor-у.
- [ ] QueryClient/tenant state не протекает между tests.
- [ ] Намеренно сломанный query key или rollback делает соответствующий owner-test красным.

## Проверка

```bash
bun run --cwd webapp test
bun run typecheck
bun run lint
```

