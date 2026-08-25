import { expect, test } from "@playwright/test";

const requestId = "123e4567-e89b-12d3-a456-426614174099";
const centralId = "123e4567-e89b-12d3-a456-426614174010";
const airportId = "123e4567-e89b-12d3-a456-426614174011";
const profile = {
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
} as const;

const window = {
  start: "2026-01-01T00:00:00.000Z",
  end: "2026-01-08T00:00:00.000Z",
  comparisonStart: "2025-12-25T00:00:00.000Z",
  comparisonEnd: "2026-01-01T00:00:00.000Z",
};
const moneyMetric = (value: string) => ({ value, previousValue: "500.00", changePercent: "40.00" });
const countMetric = (value: number) => ({ value, previousValue: 5, changePercent: "40.00" });
const kpis = (revenue: string, alerts = 1) => ({
  revenue: moneyMetric(revenue),
  grossProfit: moneyMetric("280.00"),
  orders: countMetric(10),
  averageCheck: moneyMetric("70.00"),
  grossMargin: { value: "40.00", previousValue: "35.00", changePercent: "14.29" },
  activeAlerts: { value: alerts, previousValue: alerts, changePercent: null },
});

const meta = (
  period: string,
  locationId: string | null,
  sortBy: string | null = null,
  sortDir: string | null = null,
) => ({
  asOf: "2026-01-07T12:00:00.000Z",
  demoDataRevision: 1,
  appliedFilters: { period, locationId, status: null, sortBy, sortDir },
  warnings: [],
  pagination: { mode: "none", page: null, pageSize: null, nextCursor: null, pageContext: null },
});

const overviewResponse = (period: "today" | "7d" | "30d" | "6m", locationId: string | null) => {
  const revenue = locationId === centralId ? "400.00" : period === "7d" ? "700.00" : "1000.00";
  return {
    data: {
      period,
      locationId,
      window,
      kpis: kpis(revenue),
      trend: [
        {
          bucket: period === "today" ? "2026-01-07T09" : "2026-01-07",
          revenue,
          grossProfit: "280.00",
          comparisonRevenue: "500.00",
          comparisonGrossProfit: "200.00",
        },
      ],
      goal: {
        month: "2026-01",
        revenue: "1000.00",
        target: "2000.00",
        version: 1,
        completionPercent: "50.00",
        scope: "network",
      },
      locations: [
        {
          locationId: centralId,
          name: "Central",
          revenue: "400.00",
          grossProfit: "160.00",
          orders: 6,
          activeAlerts: 1,
        },
        {
          locationId: airportId,
          name: "Airport",
          revenue: "300.00",
          grossProfit: "120.00",
          orders: 4,
          activeAlerts: 0,
        },
      ],
      topProducts: [],
      bottomProducts: [],
      stockSummary: { inStock: 5, lowStock: 1, outOfStock: 0 },
      alerts: [],
    },
    meta: meta(period, locationId),
    requestId,
  };
};

const locationsResponse = (
  period: "today" | "7d" | "30d" | "6m",
  locationId: string | null,
  sortBy: string,
  sortDir: string,
) => ({
  data: {
    period,
    locationId,
    window,
    sortBy,
    sortDir,
    locations: [
      { locationId: centralId, name: "Central", kpis: kpis("400.00"), performance: "best" },
      { locationId: airportId, name: "Airport", kpis: kpis("300.00", 0), performance: "weak" },
    ],
  },
  meta: meta(period, locationId, sortBy, sortDir),
  requestId,
});

test("updates Overview and Locations from the same location and period filters", async ({
  page,
}) => {
  let activeProfile = { ...profile, demoDataStale: true };
  let resetCalls = 0;
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { authenticated: true, profile: activeProfile },
        meta: {},
        requestId,
      }),
    }),
  );
  await page.route("**/api/v1/overview?*", (route) => {
    const url = new URL(route.request().url());
    const period = (url.searchParams.get("period") ?? "today") as "today" | "7d" | "30d" | "6m";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(overviewResponse(period, url.searchParams.get("locationId"))),
    });
  });
  await page.route("**/api/v1/locations?*", (route) => {
    const url = new URL(route.request().url());
    const period = (url.searchParams.get("period") ?? "today") as "today" | "7d" | "30d" | "6m";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        locationsResponse(
          period,
          url.searchParams.get("locationId"),
          url.searchParams.get("sortBy") ?? "revenue",
          url.searchParams.get("sortDir") ?? "desc",
        ),
      ),
    });
  });
  await page.route("**/api/v1/demo/reset", async (route) => {
    resetCalls += 1;
    activeProfile = {
      ...activeProfile,
      demoDataStale: false,
      demoDataRevision: 2,
      demoGeneratedForDate: "2026-01-07",
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          profile: activeProfile,
          generation: {
            version: "v1",
            generatedForDate: "2026-01-07",
            anchor: "2026-01-07T12:00:00.000Z",
            seed: 1,
            revision: 2,
            stale: false,
          },
          counts: {
            locations: 2,
            categories: 2,
            products: 10,
            orders: 100,
            orderItems: 100,
            inventoryItems: 10,
            inventoryBalances: 20,
            inventoryMovements: 20,
            revenueTargets: 1,
          },
        },
        meta: {},
        requestId,
      }),
    });
  });

  await page.goto("/app/overview?period=7d");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.getByRole("button", { name: "Reset demo data" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(resetCalls).toBe(0);
  await page.getByRole("button", { name: "Reset demo data" }).last().click();
  await expect.poll(() => resetCalls).toBe(1);
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText("700.00").first()).toBeVisible();
  await page.getByLabel("Location").selectOption(centralId);
  await expect.poll(() => new URL(page.url()).searchParams.get("locationId")).toBe(centralId);
  await expect(page.getByText("400.00").first()).toBeVisible();

  await page.getByRole("link", { name: "Locations" }).click();
  await expect(page.getByRole("heading", { name: "Locations" })).toBeVisible();
  await expect(page.getByText("Central").first()).toBeVisible();
  await page.getByLabel("Sort by").selectOption("grossProfit");
  await expect.poll(() => new URL(page.url()).searchParams.get("sortBy")).toBe("grossProfit");
});
