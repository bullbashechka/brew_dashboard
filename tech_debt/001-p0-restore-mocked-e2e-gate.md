# P0 — Восстановить доверие к mocked E2E gate

**Stage:** 1  
**Размер:** M  
**Зависимости:** нет  
**Primary signal:** оба Playwright project проходят весь mocked suite без глобального подавления ошибок.

## Проблема

Фактический `bun run test:e2e` 2026-08-27: **30 failed, 2 passed, 2 skipped** из 34. Основной множитель — автоматический guard в `webapp/e2e/fixtures.ts:8-34`: он складывает любой `console.error` и валит тест после его тела. Сценарии намеренно возвращают 401/404/500, браузер логирует failed resource, и guard не отличает ожидаемую негативную ветку от настоящей runtime-ошибки.

Guard также подписан только на стандартный `page` fixture (`fixtures.ts:11-22`). Real system journey создаёт дополнительный `browser.newContext()`/`secondaryPage` (`webapp/e2e/system.spec.ts:109-149`), поэтому browser failures второй tenant-сессии сейчас не попадают в collector.

Suite содержит и независимые дефекты, которые нельзя «починить» allowlist-ом:

- `webapp/e2e/accessibility.spec.ts:116` использует strict locator `getByRole("alert")`, хотя форма закономерно показывает семь ошибок.
- `webapp/e2e/sales-products.spec.ts:286-288` на mobile проверяет видимость desktop-table значения, которое существует в DOM, но скрыто responsive-разметкой.
- `webapp/e2e/analytics.spec.ts:332-343` и `webapp/e2e/first-run.spec.ts:167` таймаутятся на mobile navigation.
- Множество specs не стабят отправку product events; Vite пишет `Product event delivery failed ... status:404`, а браузерный guard видит resource errors.

## Цель

Сделать suite строгим и диагностичным: ожидаемые негативные HTTP-ответы разрешаются только там, где их явно заказал тест; `pageerror`, неожиданный `requestfailed`, необъявленный error-response и посторонний `console.error` по-прежнему немедленно делают тест красным.

## Не входит

- Не отключать guard и не добавлять глобальный regex по `401|404|500`.
- Не помечать flaky-тесты `skip`, `fixme` или serial ради зелёного результата.
- Не повышать общий timeout как основное исправление.
- Не включать real Worker/PostgreSQL journey — это задача 002.

## TDD-порядок

1. Добавить self-tests/минимальные fixture tests для guard: неожиданный `pageerror` падает; необъявленный 500 падает; один конкретно объявленный response допускается; лишний response того же статуса падает; ошибка на дополнительной page/context также падает.
2. Воспроизвести suite узко по каждому spec и классифицировать failure: fixture, locator/responsive assertion или реальная UI-регрессия.
3. Исправить default mocks для фоновой telemetry: product-event endpoint должен возвращать валидный контрактный success, если конкретный тест не проверяет delivery failure.
4. Ввести opt-in API fixture для ожидаемых HTTP failures с точным методом, pathname, status и ожидаемым количеством. Сопоставлять с наблюдёнными `response`/console location; не делать status-only suppress.
5. Исправить locator-ы семантически: проверять конкретное сообщение/поле либо `getByRole("alert").first()` только если число не является частью требования.
6. Для responsive assertions выбирать реально видимую mobile card/row, а не hidden desktop duplicate.
7. Для mobile navigation открывать drawer через пользовательский control и только потом искать link; ожидание response устанавливать до действия.

## Подводные камни

- Chromium console message о failed resource может не содержать URL; опираться только на текст нельзя. Источник истины — перехваченный HTTP response плюс его request metadata.
- Нельзя считать все product-event failures безвредными: отдельные tests должны продолжать проверять retry/delivery behavior.
- Auto fixture выполняет assertion после тела теста и может затереть первичный failure. Если уже есть test failure, attach browser failures как diagnostic attachment или объединять сообщения, не скрывая первую причину.
- Collector должен уметь подключать дополнительные pages/contexts явно и снимать listeners/закрывать context; глобальное наблюдение за чужими tests создаст утечки и гонки.
- Desktop/mobile DOM может содержать дубликаты. Assertions должны быть scoped на видимый контейнер или `data-testid`, отражающий пользовательский view.

## Критерии приёмки

- [ ] Полный mocked suite проходит в `chromium` и `mobile-chromium`; system tests остаются явно skipped только при отсутствии opt-in env.
- [ ] Есть доказательство, что новый guard валит тест на необъявленный console/page/request failure.
- [ ] Ожидаемые 401/404/500 объявляются рядом со сценарием либо его узким helper, а не глобально.
- [ ] Default API mocks отвечают на фоновые product events валидным success, если failure не является предметом теста.
- [ ] Secondary tenant page/context подключён к тому же строгому collector; self-test доказывает failure detection вне default `page`.
- [ ] Исправлены accessibility strict locator, mobile product price assertion и mobile drawer navigation.
- [ ] В output нет Recharts zero-size warnings для проверяемого видимого chart; если chart намеренно скрыт, он не монтируется в zero-size container.

## Проверка

```bash
bun run test:e2e
bun run lint
bun run typecheck
```

Зафиксировать количество passed/skipped и причины каждого skip в PR/отчёте. Одного зелёного узкого spec недостаточно.
