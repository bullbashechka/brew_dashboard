# P3 (Stage 2) — Добавить минимальные architecture/performance fitness checks

**Размер:** M  
**Go/no-go:** только после повторившегося измеряемого регресса  
**Primary signal:** маленький стабильный check ловит конкретный класс регрессии раньше релиза.

## Проблема-кандидат

Сейчас build показывает разумное route chunking и deferred Recharts chunk, но нет автоматического бюджета на initial bundle/query rows/transaction duration. Добавлять универсальную performance platform преждевременно. Fitness check оправдан только когда задача 101–103 выявит конкретный повторяемый failure mode.

## Возможные узкие checks

- initial client entry gzip не превышает согласованный budget;
- Recharts не попадает в initial entry;
- analytics benchmark на PRD-max fixture не превышает стабильный локальный/CI threshold;
- endpoint не превышает согласованный query/row count;

Выбрать только checks с владельцем и низкой flaky-вероятностью.

## Не входит

- Не поднимать новый observability vendor, dashboard или benchmark cluster.
- Не фиксировать текущие случайные числа как budget без baseline variance.
- Не делать line-count gates для god-components.
- Не переносить сюда deterministic type/grep invariants задач 005/011: они дешёвы и принадлежат acceptance своих owners.

## Порядок

1. Назвать конкретный уже случившийся regression и owning metric.
2. Измерить variance минимум несколькими runs/CI samples.
3. Выбрать deterministic proxy, максимально близкий к user/runtime signal.
4. Добавить check в существующий root script только если failure actionable и runtime мал.
5. Документировать update process, owner и false-positive escape hatch.

## Критерии приёмки

- [ ] Каждый check связан с конкретным историческим/измеренным риском.
- [ ] Failure message объясняет threshold, actual и next action.
- [ ] Check стабилен, быстр и не дублирует существующий Playwright/build gate.
- [ ] Нет новой инфраструктуры ради одной метрики.
- [ ] Удаление/обновление устаревшего threshold документировано.
