import { expect, test } from "./fixtures";

const requestId = "123e4567-e89b-12d3-a456-426614174099";
const profile = {
  userId: "123e4567-e89b-12d3-a456-426614174000",
  login: "demo.owner",
  networkId: "123e4567-e89b-12d3-a456-426614174001",
  networkName: "Roast Lab",
  ownerName: "Alex Owner",
  country: "KZ",
  currency: "KZT",
  timeZone: "Asia/Almaty",
  language: "en",
  effectiveLanguage: "en",
  onboardingCompletedAt: "2026-08-26T10:00:00.000Z",
  demoGeneratorVersion: "v1",
  demoGeneratedForDate: "2026-08-26",
  demoDataRevision: 1,
  demoDataStale: false,
  tourState: "completed",
  expiresAt: null,
} as const;

test("updates a goal, reloads feedback and preserves it through Reset", async ({ page }) => {
  let feedback: {
    rating: number;
    comment: string;
    desiredFeatures: string;
    version: number;
    submittedAt: string;
    updatedAt: string;
  } | null = null;

  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { authenticated: true, profile }, meta: {}, requestId }),
    }),
  );
  await page.route("**/api/v1/overview?*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "INTERNAL_ERROR", message: "safe", fields: {} },
        requestId,
      }),
    }),
  );
  await page.route("**/api/v1/locations?*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "INTERNAL_ERROR", message: "safe", fields: {} },
        requestId,
      }),
    }),
  );
  await page.route("**/api/v1/events", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { eventId: "123e4567-e89b-12d3-a456-426614174090" },
        meta: {},
        requestId,
      }),
    }),
  );
  await page.route("**/api/v1/settings/revenue-goal", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { month: "2026-08", monthlyGoal: "12000.00", version: 2, demoDataRevision: 1 },
        meta: {},
        requestId,
      }),
    }),
  );
  await page.route("**/api/v1/feedback", async (route) => {
    if (route.request().method() === "PUT") {
      const body = await route.request().postDataJSON();
      feedback = {
        rating: body.rating,
        comment: body.comment,
        desiredFeatures: body.desiredFeatures,
        version: (feedback?.version ?? 0) + 1,
        submittedAt: "2026-08-26T10:00:00.000Z",
        updatedAt: "2026-08-26T10:01:00.000Z",
      };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: feedback, meta: {}, requestId }),
    });
  });
  await page.route("**/api/v1/demo/reset", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          profile: { ...profile, demoDataRevision: 2 },
          generation: {
            version: "v1",
            generatedForDate: "2026-08-26",
            anchor: "2026-08-26T10:00:00.000Z",
            seed: 1,
            revision: 2,
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
        requestId,
      }),
    }),
  );

  await page.goto("/app/settings?period=today");
  await page.getByLabel("Monthly revenue goal").fill("12000");
  await page.getByRole("button", { name: "Save goal" }).click();
  await expect(page.getByText("Monthly goal saved.")).toBeVisible();

  await page.getByRole("button", { name: "Feedback" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("What should we add for you to adopt this product?").fill("POS import");
  await dialog.getByRole("button", { name: "Save feedback" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("What should we add for you to adopt this product?")).toHaveValue(
    "POS import",
  );

  await page.getByRole("button", { name: "Reset demo data" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reset demo data" }).click();
  await expect(page.getByText("Demo data has been reset.")).toBeVisible();
  await expect(page.getByLabel("What should we add for you to adopt this product?")).toHaveValue(
    "POS import",
  );
});
