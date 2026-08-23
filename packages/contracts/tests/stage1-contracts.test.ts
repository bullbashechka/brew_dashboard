import { describe, expect, it } from "bun:test";
import {
  analyticsQuerySchema,
  apiErrorResponseSchema,
  feedbackMutationSchema,
  inventoryMovementMutationSchema,
  loginRequestSchema,
  onboardingRequestSchema,
  periodSchema,
  priceMutationSchema,
  productEventRequestSchema,
  resetMutationSchema,
  utcTimestampSchema,
} from "../src/index.ts";

const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("Stage 1 shared contracts", () => {
  it("accepts valid login and rejects unknown fields or invalid aliases", () => {
    expect(
      loginRequestSchema.safeParse({ login: "owner_demo", password: "long-enough-password" })
        .success,
    ).toBe(true);
    expect(
      loginRequestSchema.safeParse({
        login: "owner_demo",
        password: "long-enough-password",
        networkId: UUID,
      }).success,
    ).toBe(false);
    expect(
      loginRequestSchema.safeParse({ login: "x", password: "long-enough-password" }).success,
    ).toBe(false);
  });

  it("validates onboarding bounds, timezone and case-insensitive location uniqueness", () => {
    const valid = {
      networkName: "  Roast   House  ",
      ownerName: "Alex Owner",
      locations: [{ name: " Central " }, { name: "Airport" }],
      country: "KZ",
      currency: "KZT",
      timeZone: "Asia/Almaty",
      idempotencyKey: UUID,
    };
    expect(onboardingRequestSchema.safeParse(valid).success).toBe(true);
    expect(onboardingRequestSchema.parse(valid).networkName).toBe("  Roast   House  ");
    expect(onboardingRequestSchema.parse(valid).locations[0]?.name).toBe(" Central ");
    expect(
      onboardingRequestSchema.safeParse({
        ...valid,
        locations: [{ name: "Central" }, { name: " cEnTrAl " }],
      }).success,
    ).toBe(false);
    expect(
      onboardingRequestSchema.safeParse({
        ...valid,
        locations: [{ name: "Central" }],
        timeZone: "Not/AZone",
      }).success,
    ).toBe(false);
    expect(onboardingRequestSchema.safeParse({ ...valid, currency: "ZZZ" }).success).toBe(false);
    expect(onboardingRequestSchema.safeParse({ ...valid, currency: "JPY" }).success).toBe(true);
    expect(onboardingRequestSchema.safeParse({ ...valid, currency: "KWD" }).success).toBe(true);
    expect(
      onboardingRequestSchema.safeParse({
        ...valid,
        networkName: "Coffee\u0000House",
      }).success,
    ).toBe(false);
  });

  it("applies the default period and bounds pagination", () => {
    const parsed = analyticsQuerySchema.parse({ page: "2", pageSize: "50" });
    expect(parsed.period).toBe("today");
    expect(parsed.page).toBe(2);
    expect(analyticsQuerySchema.safeParse({ period: "quarter" }).success).toBe(false);
    expect(analyticsQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
    expect(periodSchema.safeParse("6m").success).toBe(true);
  });

  it("rejects unknown mutation fields and invalid writeoff quantities", () => {
    expect(
      priceMutationSchema.safeParse({ price: "12.50", expectedVersion: 1, idempotencyKey: UUID })
        .success,
    ).toBe(true);
    expect(
      priceMutationSchema.safeParse({ price: "12.5", expectedVersion: 1, idempotencyKey: UUID })
        .success,
    ).toBe(false);
    expect(
      priceMutationSchema.safeParse({
        price: "12.50",
        expectedVersion: 1,
        idempotencyKey: UUID,
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      inventoryMovementMutationSchema.safeParse({
        inventoryItemId: UUID,
        locationId: UUID,
        type: "writeoff",
        quantity: "0.000",
        idempotencyKey: UUID,
      }).success,
    ).toBe(false);
    expect(
      inventoryMovementMutationSchema.safeParse({
        inventoryItemId: UUID,
        locationId: UUID,
        type: "receipt",
        quantity: "1.250",
        idempotencyKey: UUID,
      }).success,
    ).toBe(true);
  });

  it("accepts optional feedback comment and rejects arbitrary event metadata", () => {
    const feedback = feedbackMutationSchema.parse({
      rating: 5,
      desiredFeatures: "POS integration",
      expectedVersion: null,
      idempotencyKey: UUID,
    });
    expect(feedback.comment).toBe("");
    expect(
      productEventRequestSchema.safeParse({
        eventId: UUID,
        type: "section_viewed",
        route: "overview",
        metadata: { section: "overview" },
      }).success,
    ).toBe(true);
    expect(
      productEventRequestSchema.safeParse({
        eventId: UUID,
        type: "section_viewed",
        metadata: { section: "overview", text: "private feedback" },
      }).success,
    ).toBe(false);
    expect(
      productEventRequestSchema.safeParse({
        eventId: UUID,
        type: "login_succeeded",
        metadata: { password: "secret" },
      }).success,
    ).toBe(false);
  });

  it("keeps error envelopes and reset payload strict", () => {
    expect(
      apiErrorResponseSchema.safeParse({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid input",
          fields: { price: ["Required"] },
        },
        requestId: UUID,
      }).success,
    ).toBe(true);
    expect(resetMutationSchema.safeParse({ idempotencyKey: UUID }).success).toBe(true);
    expect(resetMutationSchema.safeParse({ idempotencyKey: UUID, confirm: true }).success).toBe(
      false,
    );
    expect(utcTimestampSchema.safeParse("2026-08-23T10:00:00.000Z").success).toBe(true);
    expect(utcTimestampSchema.safeParse("2026-08-23T15:00:00.000+05:00").success).toBe(false);
  });
});
