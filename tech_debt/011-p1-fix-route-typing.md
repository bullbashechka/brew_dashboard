# P1 — Восстановить transport typing Hono/OpenAPI

**Stage:** 1  
**Размер:** M  
**Зависимости:** 002; compile/runtime characterization является первым шагом этой задачи, общий harness — 003  
**Primary signal:** route registration и validated request data типизируются без системного double cast.

## Проблема

`backend/src/index.ts:524-615` регистрирует почти каждый OpenAPI handler как `as unknown as RouteHandler<...>`. Доменные HTTP-модули отдельно приводят `context.req` к собственным структурам (`analytics/http.ts:118`, `products/http.ts:7-12`, `inventory/http.ts:10-13`, onboarding/events/tour/settings/demo handlers). В итоге contracts формально существуют, но compiler не доказывает соответствие route input handler-у.

Root `backend/src/index.ts` также объединяет route declarations (`:88-500`), registrations, middleware и error boundary, что усиливает проблему.

## Цель

Добиться одного типизированного route→handler пути на домен. Если ограничение текущих Hono/OpenAPI generics делает узкий adapter необходимым, unsafe cast должен существовать в одном документированном месте с type-level tests, а не в каждой регистрации.

## Порядок

1. Создать минимальный compile-time fixture: несовместимый handler input/output должен давать `@ts-expect-error`, совместимый — компилироваться.
2. Проверить, можно ли объявлять route и handler в одном доменном модуле так, чтобы inference сохранялся напрямую.
3. Перенести route declarations/registration домен за доменом; root app оставляет middleware, composition и global errors.
4. Централизовать доступ к `req.valid("query"|"json"|"param")` через library-typed context. Если нужен adapter — один generic helper, без runtime работы.
5. Удалить все локальные `as unknown as RouteHandler` и самодельные `valid` shapes.

## Не входит

- Не обновлять Hono/Zod/OpenAPI packages только ради эстетики без отдельного compatibility анализа.
- Не строить собственный router framework или code generator.
- Не менять URLs, status codes, middleware order или response envelopes.
- Не смешивать transport types с service/database types.

## Подводные камни

- Middleware order критичен: request ID, observability, auth и onboarding guard должны остаться на тех же route groups.
- Типизированный wrapper не должен использовать `any`/double cast внутри каждого вызова; один boundary cast допустим лишь с объяснением ограничения upstream types.
- OpenAPI response typing может конфликтовать с centralized error responses. Не ослаблять route schema до `unknown`; моделировать общие errors или оставить узкий boundary.
- Route modules не должны создавать import cycle через root `app`.

## Критерии приёмки

- [ ] `rg 'as unknown as RouteHandler|req as unknown as.*valid' backend/src` не находит доменных обходов.
- [ ] Несовместимый handler compile-time test падает.
- [ ] Root app является composition root, а route ownership виден по доменам.
- [ ] Middleware order, OpenAPI output и runtime contracts не изменились.
- [ ] Unit/integration/E2E suites зелёные.
- [ ] Локальный type/`rg` invariant запрещает возврат доменных double casts; переносить это в 104 не требуется.

## Проверка

```bash
rg -n 'as unknown as RouteHandler|req as unknown as' backend/src
bun run typecheck
bun run test
bun run test:integration
bun run lint
bun run build
```
