import { expect, test } from "./fixtures";
import {
  locationsResponseSchema,
  overviewResponseSchema,
  revenueGoalMutationSchema,
} from "@brew-dashboard/contracts";

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

const window = {
  start: "2026-08-26T00:00:00.000Z",
  end: "2026-08-27T00:00:00.000Z",
  comparisonStart: "2026-08-25T00:00:00.000Z",
  comparisonEnd: "2026-08-26T00:00:00.000Z",
};

const meta = (demoDataRevision: number) => ({
  asOf: "2026-08-26T10:00:00.000Z",
  demoDataRevision,
  appliedFilters: { period: "today", locationId: null, status: null, sortBy: null, sortDir: null },
  warnings: [],
  pagination: { mode: "none", page: null, pageSize: null, nextCursor: null, pageContext: null },
});

const initialOverview = () =>
  overviewResponseSchema.parse({
    data: {
      period: "today",
      locationId: null,
      window,
      kpis: {
        revenue: { value: "10000.00", previousValue: "9000.00", changePercent: "11.11" },
        grossProfit: { value: "4000.00", previousValue: "3600.00", changePercent: "11.11" },
        orders: { value: 100, previousValue: 90, changePercent: "11.11" },
        averageCheck: { value: "100.00", previousValue: "100.00", changePercent: "0.00" },
        grossMargin: { value: "40.00", previousValue: "40.00", changePercent: "0.00" },
        activeAlerts: { value: 0, previousValue: 0, changePercent: null },
      },
      trend: [],
      goal: {
        month: "2026-08",
        revenue: "10000.00",
        target: "10000.00",
        version: 1,
        completionPercent: "100.00",
        scope: "network",
      },
      locations: [],
      topProducts: [],
      bottomProducts: [],
      stockSummary: { inStock: 0, lowStock: 0, outOfStock: 0 },
      alerts: [],
    },
    meta: meta(1),
    requestId,
  });

const initialLocations = () =>
  locationsResponseSchema.parse({
    data: {
      period: "today",
      locationId: null,
      window,
      sortBy: "revenue",
      sortDir: "desc",
      locations: [],
    },
    meta: {
      ...meta(1),
      appliedFilters: { ...meta(1).appliedFilters, sortBy: "revenue", sortDir: "desc" },
    },
    requestId,
  });

test("updates a goal, reloads feedback and preserves it through Reset", async ({ page }) => {
  let feedback: {
    rating: number;
    comment: string;
    desiredFeatures: string;
    version: number;
    submittedAt: string;
    updatedAt: string;
  } | null = null;
  let overview = initialOverview();
  let locations = initialLocations();

  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { authenticated: true, profile }, meta: {}, requestId }),
    }),
  );
  await page.route("**/api/v1/overview?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(overview),
    }),
  );
  await page.route("**/api/v1/locations?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(locations),
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
  await page.route("**/api/v1/settings/revenue-goal", async (route) => {
    const body = revenueGoalMutationSchema.parse(await route.request().postDataJSON());
    expect(body).toMatchObject({
      monthlyGoal: "12000.00",
      expectedVersion: 1,
      expectedDemoDataRevision: 1,
    });
    expect(body.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    overview = overviewResponseSchema.parse({
      ...overview,
      data: { ...overview.data, goal: { ...overview.data.goal!, target: "12000.00", version: 2 } },
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { month: "2026-08", monthlyGoal: "12000.00", version: 2, demoDataRevision: 1 },
        meta: {},
        requestId,
      }),
    });
  });
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
  await page.route("**/api/v1/demo/reset", async (route) => {
    overview = overviewResponseSchema.parse({
      ...overview,
      data: { ...overview.data, goal: { ...overview.data.goal!, target: "10000.00", version: 3 } },
      meta: meta(2),
    });
    locations = locationsResponseSchema.parse({
      ...locations,
      meta: { ...meta(2), appliedFilters: locations.meta.appliedFilters },
    });
    await route.fulfill({
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
    });
  });

  await page.goto("/app/settings?period=today");
  await page.getByLabel("Monthly revenue goal").fill("12000");
  await Promise.all([
    page.waitForResponse("**/api/v1/settings/revenue-goal"),
    page.getByRole("button", { name: "Save goal" }).click(),
  ]);
  await expect(page.getByText("Monthly goal saved.")).toBeVisible();
  await expect(page.getByLabel("Monthly revenue goal")).toHaveValue("12000.00");

  const feedbackButton = page.getByRole("button", { name: "Feedback", exact: true });
  if (!(await feedbackButton.isVisible())) {
    await page.getByRole("button", { name: "Open navigation" }).click();
  }
  await feedbackButton.click();
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
