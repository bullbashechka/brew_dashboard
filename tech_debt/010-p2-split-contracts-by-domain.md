# P2 — Разделить shared contracts по доменам с совместимым barrel

**Stage:** 1, opportunistic  
**Размер:** S–M  
**Зависимости:** выполнять при следующем существенном contract change или повторном merge conflict  
**Primary signal:** consumers продолжают импортировать тот же public API, а доменные изменения получают ясного владельца.

## Переоценённая проблема

`packages/contracts/src/index.ts` содержит 846 строк: primitives, error envelopes, auth/onboarding, analytics, mutations, feedback и product events (`:1-846`). Контракты покрыты почти полностью. Размер и потенциальный merge blast radius — changeability debt, но текущего runtime/correctness дефекта нет, поэтому задача P2 и не обязана опережать feature/release work.

## Триггер

Начинать при существенном изменении контракта в одном из доменов, повторном merge conflict либо доказанном import/cycle review pain. Не делать отдельный churn-PR только ради числа строк.

## Минимальная структура

- `primitives.ts` — decimal/uuid/timezone/language/version normalization.
- `envelopes.ts` — success/error/meta/pagination primitives.
- `auth.ts`, `onboarding.ts`, `settings.ts`, `events.ts`.
- Analytics разделить на common и домены только там, где файлы остаются связными; не создавать файл на schema.
- `index.ts` — explicit backward-compatible re-exports без логики.

## Порядок

1. Зафиксировать export-surface/parse tests для затронутого домена.
2. Переносить снизу вверх: primitives/envelopes → один фактически меняемый domain.
3. Оставить consumers на root imports в первом проходе; deep imports не вводить без bundle/cycle evidence.
4. При касании `stage1-contracts.test.ts`/`stage4-contracts.test.ts` переименовать/разделить их по предметному домену без отдельного массового PR.
5. Остановиться после устранения конкретного trigger; остальные домены не перемещать автоматически.

## Не входит

- Не менять schema strictness, error messages или API fields.
- Не генерировать contracts из новой DSL.
- Не создавать по файлу на каждую schema.
- Не вводить deep imports как обязательный public API.

## Подводные камни

- Zod `.extend`, discriminated unions и inferred types имеют порядок зависимостей; не создавать циклы.
- Normalization helpers являются runtime exports; сохранить identity/side-effect-free behavior.
- Любое фактическое schema изменение требует проверки backend producer и webapp consumer; structural move такого изменения содержать не должен.

## Критерии приёмки

- [ ] Указан реальный trigger, а scope ограничен затронутыми доменами.
- [ ] Root package экспортирует прежние symbols; consumers typecheck без массовой смены imports.
- [ ] `index.ts` содержит только explicit re-exports, затронутые domain files не имеют cycles.
- [ ] Parse/reject/error behavior не изменилось.
- [ ] Historical stage-test names исправлены только в реально затронутом contract scope.

## Проверка

```bash
bun run --cwd packages/contracts test
bun run typecheck
bun run test
bun run lint
bun run build
```

