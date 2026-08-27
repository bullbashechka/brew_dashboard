# P2 — Разделить словари и runtime i18n без смены решения

**Stage:** 1  
**Размер:** S  
**Зависимости:** существующие i18n/parity tests; новый shared harness не требуется  
**Primary signal:** parity/type safety словарей сохраняется, runtime helpers и data меняются независимо.

## Проблема

`webapp/src/lib/i18n.ts` содержит 753 строки: English/Russian dictionaries занимают основную часть файла, а locale selection, translation lookup, number/date/currency/error formatting находятся в том же модуле. Это создаёт merge conflicts и затрудняет review переводов, хотя runtime design сам по себе достаточен.

## Цель

Разнести данные словарей и runtime helpers, сохранив compile-time `TranslationKey`, parity checks, fallback/error semantics и текущую eager delivery. Lazy locale loading не нужно без bundle-порога.

## Порядок

1. Зафиксировать tests: EN/RU key parity, missing/extra key compile/runtime failure, interpolation, currency/date/timezone, API error mapping.
2. Вынести canonical English dictionary и Russian dictionary в соседние modules.
3. Оставить `i18n.ts` public facade/runtime: locale resolution, translate/format helpers и re-export нужных types.
4. Проверить отсутствие import cycles с contracts/profile/API errors.
5. Не менять translation copy в структурном PR, кроме обнаруженных явных parity defects отдельным commit.

## Не входит

- Не подключать i18n library, code generation или remote translation service.
- Не внедрять lazy locale chunks без измеренного initial-bundle требования.
- Не перестраивать все call sites/imports.

## Подводные камни

- `TranslationKey` лучше выводить из canonical EN dictionary; RU должен удовлетворять тот же shape без widening к `string`.
- Формат currency/decimal должен сохранить locale и contract strings; не преобразовывать деньги через float.
- API errors могут иметь field-level/localized mapping; fallback не должен показать internal message.

## Критерии приёмки

- [ ] Словари находятся отдельно от runtime helpers и имеют compile-time одинаковые keys.
- [ ] Public imports consumers остаются стабильными.
- [ ] Formatting/error/interpolation tests зелёные для обеих locales.
- [ ] Bundle не вырос заметно и не добавлена новая dependency.
- [ ] Нет массовой правки translation copy в том же изменении.

## Проверка

```bash
bun run --cwd webapp test
bun run typecheck
bun run lint
bun run build
```
