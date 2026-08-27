# P2 — Убрать moderate transitive esbuild advisory

**Stage:** 1  
**Размер:** S  
**Зависимости:** нет  
**Primary signal:** vulnerable dev-tool path удалён совместимым обновлением либо риск принят явно и ограниченно.

## Проблема и фактическая policy

Baseline `bun audit --json` возвращает exit 1 для GHSA-67mh-4wv8-2f99 (`esbuild <=0.24.2`). Lockfile path: `drizzle-kit@0.31.10 → @esbuild-kit/esm-loader@2.6.5 → @esbuild-kit/core-utils@3.3.2 → esbuild@0.18.20`. Другие paths уже используют безопасные `0.25.12`/`0.28.1`.

Уязвимость относится к dev-server request exposure; copy является tooling dependency, не production Worker runtime. `scripts/audit.mjs:24-37` не скрывает finding: он печатает все advisories и по осознанной severity-aware policy блокирует high/critical. Поэтому текущий finding — P2 hygiene. P1 он станет только после отдельного решения о zero-advisory release policy или при появлении production/reachable path.

## Цель

Предпочтительно удалить legacy path минимальным совместимым обновлением Drizzle Kit/loader. Если безопасного upstream пути нет, зафиксировать временное принятие риска: advisory ID, reachability rationale, owner, review/expiry date.

## Порядок

1. Зафиксировать `bun pm why esbuild` и текущий lockfile path.
2. Проверить совместимую patch/minor версию Drizzle Kit и release notes; не обновлять ORM/Auth/Cloudflare stack пакетом.
3. Предпочесть прямой dev dependency upgrade, удаляющий legacy loader.
4. Override/resolution использовать только с фактической проверкой loader/CLI compatibility.
5. Если risk accepted, не менять severity policy молча: добавить узкое документированное исключение/decision с expiry.

## Не входит

- Не менять production dependency stack без необходимости.
- Не генерировать/редактировать applied migrations.
- Не игнорировать весь package или severity class.
- Не превращать текущий explicit warning в blocking gate без отдельного policy решения.

## Подводные камни

- `drizzle-kit generate` может создать migration artifact; для проверки достаточно `db:check`/безопасных CLI paths, если generation не нужен.
- Override может очистить audit и сломать runtime API legacy loader; audit green недостаточно.
- Прямой `bun audit` и root severity wrapper намеренно имеют разные exit semantics; задокументировать это, а не считать ошибкой автоматически.

## Критерии приёмки

- [ ] Vulnerable path отсутствует либо есть узкое принятое исключение с owner/expiry.
- [ ] При обновлении `bun audit --json` не содержит advisory 1102341.
- [ ] При risk acceptance root audit продолжает явно показывать finding/policy result.
- [ ] `db:check`, tests, typecheck и build проходят; migration/schema diff отсутствует.
- [ ] Dependency change минимален и объяснён.

## Проверка

```bash
bun pm why esbuild
bun audit --json
bun run audit
bun run db:check
bun run test
bun run typecheck
bun run build
```

