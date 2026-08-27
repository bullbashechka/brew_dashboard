# P2 (Stage 2) — Сократить время удержания request DB transaction

**Размер:** L  
**Go/no-go:** только после измерения connection/transaction duration и saturation  
**Primary signal:** меньше hold time/очередей без ослабления RLS и consistency.

## Наблюдение

`backend/src/auth/http.ts:348-412` открывает request database connection/transaction, проверяет Better Auth session, блокирует user, загружает authoritative profile, устанавливает tenant context и выполняет весь downstream handler через `await next()` внутри той же transaction. Это логично для transaction-local RLS, но соединение удерживается во время analytics calculations и response serialization. `withRequestDatabase` создаёт request client; в Workers/Hyperdrive нельзя автоматически применять обычные Node pooling советы.

## Условие старта

Telemetry/load probe подтверждает высокий p95 transaction duration, connection queue/saturation или заметную долю CPU после последнего SQL внутри transaction. Без этого текущая простая safety boundary остаётся.

## Исследование

1. Измерить auth time, first/last DB operation, downstream pure compute, serialization, commit и total request; не логировать session/user/tenant secrets.
2. Разделить endpoints на DB-bound mutations, snapshot reads и no-DB paths.
3. Проверить Hyperdrive/Workers/Postgres transaction and connection guidance перед дизайном.
4. Рассмотреть самый малый вариант: внутри transaction собрать immutable response data, после commit выполнить только безопасную serialization; либо endpoint-specific transaction runner. Tenant-derived data не должна читаться после context loss.

## Не входит

- Не отключать transaction-local RLS/tenant settings.
- Не доверять client `network_id`.
- Не добавлять глобальный Node pool в Worker без platform proof.
- Не разбивать atomic mutations на несколько transactions.

## Подводные камни

- Better Auth session validation и profile lock защищают revocation/concurrency; нельзя кэшировать profile без модели invalidation.
- Ответ после commit не должен зависеть от lazy DB reads.
- Read snapshot consistency может измениться при нескольких transactions.
- Error mapping/Set-Cookie behavior до и после commit обязано сохраниться.

## Критерии приёмки

- [ ] Before/after hold-time и saturation evidence на representative concurrency.
- [ ] Tenant RLS negative tests, auth revocation и atomic mutation rollback проходят real DB suite.
- [ ] Нет global pool/secret logging/client tenant scope.
- [ ] Архитектура остаётся понятной: одна явная transaction boundary на operation.
- [ ] Изменение откатывается без data migration.

