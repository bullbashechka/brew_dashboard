# P1 — Разделить независимые Settings workflows

**Stage:** 1  
**Размер:** M  
**Зависимости:** 005; characterization является первым шагом этой задачи  
**Primary signal:** language, goal, reset и account actions имеют независимые testable owners без generic settings state.

## Проблема

`webapp/src/components/settings-page.tsx` — 393 строки. `:41-135` координирует profile/overview queries, optimistic language rollback, tour mutation, goal draft/snapshot/conflict и reset/logout; далее одна page render собирает все settings sections. У этих workflows разные failure/recovery semantics, но один coordinator.

## Цель

Разделить Language, RevenueGoal, DemoReset и Account/Tour sections. Каждый сложный workflow получает локальный controller/component; page только получает profile/overview и композирует секции. Не создавать общий `useSettings` reducer.

## TDD-порядок

1. Language: optimistic update и полный rollback `language/effectiveLanguage`.
2. Goal: dirty snapshot, success, stale version/conflict, refresh без перезаписи пользовательского draft.
3. Reset: confirmation, pending/error/success, feedback preservation, session revision update и tenant invalidation.
4. Account/tour/logout: callback order, query cancellation/clear и navigation остаются на существующем owner boundary с AppShell.
5. Извлекать по одной independently mergeable section; после каждой — settings component/E2E tests.

## Не входит

- Не менять Settings UX/copy или backend contracts.
- Не отделять goal от Overview отдельным endpoint — это условная задача 102.
- Не создавать generic mutation/toast/form abstraction.
- Не переносить logout ownership одновременно с task 006 без явного одного владельца.

## Подводные камни

- Optimistic language rollback должен восстанавливать оба locale поля и не оставлять UI на mixed locale.
- Goal conflict refresh не должен молча заменить dirty draft.
- Reset сохраняет feedback и auth/account; новый profile кладётся в session cache до tenant invalidation.
- Logout cancel/clear/navigation order важен для tenant cache hygiene.

## Критерии приёмки

- [ ] Четыре workflow имеют отдельные readable boundaries; generic settings state отсутствует.
- [ ] Language/goal/reset negative paths имеют direct tests.
- [ ] Reset feedback/session/cache semantics и goal conflict защищены E2E.
- [ ] QueryClient доступен только workflow/page controllers, не read-only fields/cards.
- [ ] Каждая section может быть внедрена/откачена независимо.

## Проверка

```bash
bun run --cwd webapp test
bun run test:e2e
bun run typecheck
bun run lint
```

