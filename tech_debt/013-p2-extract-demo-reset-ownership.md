# P2 — Вернуть demo reset в правильный домен

**Stage:** 1  
**Размер:** S–M  
**Зависимости:** 002; reset characterization является первым шагом этой задачи  
**Primary signal:** onboarding и reset имеют отдельных владельцев, общая generation/persistence логика не дублируется.

## Проблема

`backend/src/demo/reset.ts:1` — re-export `resetDemoData` из `onboarding/service.ts`. Сам onboarding service (536 строк) содержит language/onboarding transitions, demo counts/generation/persistence/clear и reset (`:158-535`). HTTP import создаёт видимость demo boundary, которой фактически нет.

## Цель

Сделать demo reset реальным domain owner и оставить onboarding service владельцем first-run transitions. Общие операции generation/persistence должны иметь одну реализацию без универсального lifecycle framework.

## Порядок

1. Зафиксировать characterization: reset revision increment, deterministic counts, feedback preservation, idempotency и rollback.
2. Перенести `resetDemoData` в `demo/reset.ts` вместе с только reset-specific orchestration.
3. Общие `getDemoCounts`, `buildGenerationResult`, `clearDemoData`/persist helpers вынести в один `demo/service.ts` только если их реально используют onboarding и reset.
4. Оставить onboarding language/complete операции и hooks в onboarding domain.
5. Упростить imports; удалить re-export shims, если они больше не нужны.

## Не входит

- Не переписывать хорошо покрытый `domain/demo-generator.ts` целиком.
- Не менять generated data distribution, counts, transaction boundary или API response.
- Не добавлять generic workflow engine.

## Подводные камни

- Reset должен сохранять feedback, account/session и выбранный language согласно PRD.
- Очистка и повторная генерация обязаны оставаться в одной request transaction; partial reset недопустим.
- Revision check защищает concurrent/stale reset; не переносить его за transaction boundary.
- Hooks tests могут зависеть от этапов failure injection; сохранить точки или заменить равнозначными.

## Критерии приёмки

- [ ] `demo/reset.ts` содержит реальную reset orchestration либо заменён одним ясно названным demo service.
- [ ] Onboarding service больше не экспортирует reset operation.
- [ ] Общая persistence логика существует в одном месте, без circular imports.
- [ ] Reset preservation/rollback/idempotency tests зелёные.
- [ ] API contracts, counts и revision semantics не изменились.

## Проверка

```bash
bun run test
bun run test:integration
bun run typecheck
bun run lint
```
