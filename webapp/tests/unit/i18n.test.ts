import { describe, expect, it } from "bun:test";
import { assertDictionaryParity, dictionaries, translate } from "../../src/lib/i18n";

describe("translations", () => {
  it("keeps RU keys equal to the English source dictionary", () => {
    expect(() => assertDictionaryParity(dictionaries.en, dictionaries.ru)).not.toThrow();
  });

  it("fails when a translation key is missing", () => {
    const incomplete = structuredClone(dictionaries.ru) as Record<string, unknown>;
    delete (incomplete.actions as Record<string, string>).retry;
    expect(() => assertDictionaryParity(dictionaries.en, incomplete)).toThrow("actions.retry");
  });

  it("resolves declared translation keys", () => {
    expect(translate("ru", "navigation.overview")).toBe("Обзор");
    expect(translate("en", "navigation.overview")).toBe("Overview");
  });
});
