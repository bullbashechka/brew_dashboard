import { describe, expect, it } from "bun:test";
import type { Profile } from "@brew-dashboard/contracts";

import { formatCurrency, formatPercent } from "../../src/lib/i18n";

const profile: Profile = {
  userId: "123e4567-e89b-12d3-a456-426614174000",
  login: "demo.owner",
  networkId: "123e4567-e89b-12d3-a456-426614174001",
  networkName: "Roast Lab",
  ownerName: "Alex",
  country: "KZ",
  currency: "KZT",
  timeZone: "Asia/Almaty",
  language: "en",
  effectiveLanguage: "en",
  onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  demoGeneratorVersion: "v1",
  demoGeneratedForDate: "2026-01-01",
  demoDataRevision: 1,
  demoDataStale: false,
  tourState: "completed",
  expiresAt: null,
};

describe("analytics formatting", () => {
  it("uses the profile currency and exposes unavailable percentage values", () => {
    expect(formatCurrency("1234.50", profile)).toContain("KZT");
    expect(formatPercent("12.50", profile)).toBe("12.5%");
    expect(formatPercent(null, profile)).toBe("N/A");
  });

  it("localizes unavailable percentage values", () => {
    expect(formatPercent(null, { ...profile, language: "ru", effectiveLanguage: "ru" })).toBe(
      "Н/Д",
    );
  });
});
