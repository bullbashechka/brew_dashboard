# Реестр технического долга

Дата baseline-аудита: 2026-08-27.

Это не список пожеланий и не предложение переписать систему. Репозиторий остаётся модульным serverless-монолитом на одном Worker и PostgreSQL — для текущего MVP это подходящая архитектура. В Stage 1 входят только подтверждённые дефекты release-сигнала, пробелы в страховочной сетке и локальные точки избыточной связанности. Stage 2 начинается лишь после измерений и отдельного продуктового решения.

## Шкала

- **P0** — релизный сигнал сейчас недостоверен либо критический пользовательский/tenant-сценарий не доказан.
- **P1** — высокая вероятность регрессии или высокая стоимость ближайших изменений; устраняется локально.
- **P2** — поддерживаемость и скорость разработки; допустимо отложить после P0/P1.
- **P3** — условная оптимизация. Выполнять только при подтверждённом пороге.

Размер: **S** — до 1 дня, **M** — 1–3 дня, **L** — несколько итераций и обязательный отдельный go/no-go.

## Stage 1 — ближайший результат

Порядок ниже является порядком выполнения, а не сортировкой по числу строк.

| № | Приоритет | Размер | Задача | Зачем сейчас |
|---:|:---:|:---:|---|---|
| 1 | P0 | M | [Восстановить доверие к mocked E2E gate](001-p0-restore-mocked-e2e-gate.md) | `bun run test:e2e`: 30 failed, 2 passed, 2 skipped; общий guard маскирует самостоятельные дефекты тестов. |
| 2 | P0 | M | [Закрыть real DB и tenant-isolation gate](002-p0-close-real-db-system-gate.md) | Integration/system-пути с PostgreSQL не подтверждены текущим запуском. |
| 3 | P1 | S | [Централизовать query keys и cache policy](005-p1-query-key-factories.md) | Ручные строковые prefixes уже дублируются в mutation/reset-потоках. |
| 4 | P1 | M | [Разделить ответственность AppShell](006-p1-decompose-app-shell.md) | Shell одновременно владеет routing filters, запросами, feedback, telemetry, tour, logout и UI. |
| 5 | P1 | M | [Выделить Inventory mutation controller](007a-p1-decompose-inventory-page.md) | Conflict/retry/filter recovery и cache invalidation смешаны с 300+ строками представления. |
| 6 | P1 | S–M | [Выделить Products price editor](007b-p1-decompose-products-page.md) | Dialog/mutation/cache lifecycle связан с matrix/cards и historical metrics. |
| 7 | P1 | M | [Разделить Settings workflows](007c-p1-decompose-settings-page.md) | Language, tour, goal, reset, feedback и logout имеют разные state machines в одном coordinator. |
| 8 | P1 | M | [Разделить backend analytics по ответственности](009-p1-split-analytics-service.md) | Один 1273-строчный service владеет SQL snapshot, расчётами, фильтрацией и пятью response builders. |
| 9 | P1 | M | [Восстановить transport typing Hono/OpenAPI](011-p1-fix-route-typing.md) | Все регистрации маршрутов обходят типы через `as unknown as RouteHandler`; validation casts размножены. |
| 10 | P1 | S–M | [Закрыть только реальные backend test gaps](003-p1-backend-test-gaps.md) | Integration coverage сильнее fast coverage; нужны gap analysis и shared harness, а не дублирование ради процентов. |
| 11 | P1 | S | [Собрать минимальный frontend test harness](004-p1-frontend-test-harness.md) | Существующий fetch/QueryClient подход нужно переиспользовать для owner-specific TDD. |
| 12 | P2 | S–M | [Вернуть demo reset в правильный домен](013-p2-extract-demo-reset-ownership.md) | `demo/reset.ts` — пустой re-export, а reset и генерация живут в onboarding service. |
| 13 | P2 | S | [Разделить словари и runtime i18n](014-p2-split-i18n-module.md) | 753 строки данных и логики в одном файле создают конфликты; runtime менять не требуется. |
| 14 | P2 | Conditional | [Извлекать read-only analytics sections только по триггеру](008-p2-conditional-analytics-page-extraction.md) | Coordinators уже локально ясны; механическая раскладка файлов сама по себе не даёт результата. |
| 15 | P2 | S–M | [Разделить shared contracts по доменам](010-p2-split-contracts-by-domain.md) | Полезная changeability-гигиена, но runtime/correctness риска сейчас не доказано. |
| 16 | P2 | S | [Убрать moderate esbuild advisory](012-p2-resolve-esbuild-advisory.md) | Dev-tool path уязвим; текущая severity-aware policy осознанно блокирует только high/critical. |

## Stage 2 — сложные задачи, нужен отдельный go/no-go

| № | Приоритет | Размер | Задача | Условие старта |
|---:|:---:|:---:|---|---|
| 101 | P2 | L | [Измерить и оптимизировать analytics query shape](101-p2-optimize-analytics-query-shape.md) | Только если production-like объём нарушает PRD performance budgets или лимиты памяти/CPU. |
| 102 | P2 | M–L | [Убрать дублирующую загрузку overview ради alerts](102-p2-separate-alert-summary.md) | После профиля запросов доказать, что лишний snapshot материален. |
| 103 | P2 | L | [Сократить время удержания DB transaction](103-p2-shorten-request-transactions.md) | После измерения transaction/connection duration; RLS нельзя ослаблять. |
| 104 | P3 | M | [Добавить минимальные architecture/performance fitness checks](104-p3-fitness-checks.md) | Только для уже измеренного повторяющегося регресса, без нового observability-стека. |

## Что сознательно не является задачей

- Не выделять микросервисы, очереди, CQRS, repository framework или новый state manager: текущие требования этого не оправдывают.
- Не дробить `backend/src/db/schema.ts` только из-за 622 строк: централизованная видимость связей и RLS полезна, а подтверждённого ownership-конфликта нет.
- Не переписывать хорошо покрытый demo generator целиком: сначала исправляется ownership reset-потока, затем только локальные извлечения.
- Не вводить произвольный глобальный coverage percentage. Проверяется поведение высокорисковых путей, а не метрика ради метрики.
- Не считать generated migrations, build artifacts или текущий пользовательский diff мёртвым кодом; применённые миграции не редактируются.

## Зависимости выполнения

`001 → 002` — единственные P0 и checkpoint честного release-сигнала. Characterization выполняется первым шагом конкретного владельца в `006`, `007a–007c`, `009`, `011` и `013`; задачи `003/004` оставлены только для общих harness/gaps, которые нельзя разумно держать у одного владельца. `005` выполняется до mutation-page refactors. `009` — только структурное разделение без изменения SQL; результаты `101–103` не должны протекать в Stage 1.
