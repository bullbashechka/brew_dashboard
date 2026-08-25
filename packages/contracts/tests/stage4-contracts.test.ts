import { describe, expect, it } from "bun:test";

import {
  onboardingCompleteResponseSchema,
  priceMutationSchema,
  profileSchema,
} from "../src/index.ts";

const UUID = "123e4567-e89b-12d3-a456-426614174000";

const profile = {
  userId: UUID,
  login: "owner_demo",
  networkId: UUID,
  networkName: "Roast House",
  ownerName: "Alex Owner",
  country: "KZ",
  currency: "KZT",
  timeZone: "Asia/Almaty",
  language: "en",
  effectiveLanguage: "en",
  onboardingCompletedAt: "2026-08-25T07:00:00.000Z",
  demoGeneratorVersion: "v1",
  demoGeneratedForDate: "2026-08-25",
  demoDataRevision: 1,
  demoDataStale: false,
  tourState: "pending",
  expiresAt: null,
};

describe("Stage 4 shared contracts", () => {
  it("exposes nullable language with an effective fallback and generation state", () => {
    expect(
      profileSchema.parse({
        ...profile,
        language: null,
        effectiveLanguage: "en",
        demoGeneratorVersion: null,
        demoGeneratedForDate: null,
        demoDataRevision: 0,
        demoDataStale: false,
        onboardingCompletedAt: null,
        networkName: null,
        ownerName: null,
        country: null,
        currency: null,
        timeZone: null,
      }).effectiveLanguage,
    ).toBe("en");
  });

  it("accepts the new revision on mutation contracts and keeps the default for older clients", () => {
    expect(
      priceMutationSchema.parse({
        price: "12.50",
        expectedVersion: 1,
        idempotencyKey: UUID,
      }).expectedDemoDataRevision,
    ).toBe(1);
    expect(
      priceMutationSchema.safeParse({
        price: "12.50",
        expectedVersion: 1,
        expectedDemoDataRevision: 2,
        idempotencyKey: UUID,
      }).success,
    ).toBe(true);
  });

  it("rejects contradictory profile and generation state", () => {
    expect(() => profileSchema.parse({ ...profile, effectiveLanguage: "ru" })).toThrow();
    expect(() => profileSchema.parse({ ...profile, demoDataRevision: 0 })).toThrow();
    expect(() =>
      onboardingCompleteResponseSchema.parse({
        data: {
          profile,
          generation: {
            version: "v1",
            generatedForDate: "2026-08-25",
            anchor: "2026-08-25T07:00:00.000Z",
            seed: 42,
            revision: 1,
            stale: true,
          },
          counts: {
            locations: 3,
            categories: 3,
            products: 12,
            orders: 100,
            orderItems: 200,
            inventoryItems: 12,
            inventoryBalances: 36,
            inventoryMovements: 36,
            revenueTargets: 1,
          },
        },
        meta: {},
        requestId: UUID,
      }),
    ).toThrow();
  });

  it("parses the onboarding completion success envelope", () => {
    const response = onboardingCompleteResponseSchema.parse({
      data: {
        profile,
        generation: {
          version: "v1",
          generatedForDate: "2026-08-25",
          anchor: "2026-08-25T07:00:00.000Z",
          seed: 42,
          revision: 1,
          stale: false,
        },
        counts: {
          locations: 3,
          categories: 3,
          products: 12,
          orders: 100,
          orderItems: 200,
          inventoryItems: 12,
          inventoryBalances: 36,
          inventoryMovements: 36,
          revenueTargets: 1,
        },
      },
      meta: {},
      requestId: UUID,
    });
    expect(response.data.generation.revision).toBe(1);
  });
});
