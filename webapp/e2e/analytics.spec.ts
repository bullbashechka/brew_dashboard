import { expect, test } from "@playwright/test";
import type { LocationsData, OverviewData, Profile } from "@brew-dashboard/contracts";

const requestId = "123e4567-e89b-12d3-a456-426614174099";
const centralId = "123e4567-e89b-12d3-a456-426614174010";
const airportId = "123e4567-e89b-12d3-a456-426614174011";
const productId = "123e4567-e89b-12d3-a456-426614174012";
const alertId = "123e4567-e89b-12d3-a456-426614174013";
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

const periodWindow = {
  start: "2026-01-01T00:00:00.000Z",
  end: "2026-01-08T00:00:00.000Z",
  comparisonStart: "2025-12-25T00:00:00.000Z",
  comparisonEnd: "2026-01-01T00:00:00.000Z",
};
type AnalyticsPeriod = "today" | "7d" | "30d" | "6m";

const analyticsVariant = (period: AnalyticsPeriod, locationId: string | null) => {
  const periodSeed = { today: 1, "7d": 7, "30d": 30, "6m": 60 }[period];
  const seed = periodSeed + (locationId === centralId ? 10 : 0);
  const revenue = seed * 100 + 300;
  const orders = seed + 3;
  const label = `${locationId === centralId ? "Central" : "Network"} ${period}`;
  return {
    label,
    seed,
    revenue: revenue.toFixed(2),
    grossProfit: (revenue * 0.4).toFixed(2),
    orders,
    averageCheck: (revenue / orders).toFixed(2),
    activeAlerts: period === "30d" ? 4 : locationId === centralId ? 2 : 1,
    changePercent: `${seed}.00`,
  };
};

const kpis = (period: AnalyticsPeriod, locationId: string | null) => {
  const variant = analyticsVariant(period, locationId);
  const moneyMetric = (value: string) => ({
    value,
    previousValue: (Number(value) - variant.seed).toFixed(2),
    changePercent: variant.changePercent,
  });
  const countMetric = (value: number) => ({
    value,
    previousValue: Math.max(0, value - 1),
    changePercent: variant.changePercent,
  });
  return {
    revenue: moneyMetric(variant.revenue),
    grossProfit: moneyMetric(variant.grossProfit),
    orders: countMetric(variant.orders),
    averageCheck: moneyMetric(variant.averageCheck),
    grossMargin: {
      value: "40.00",
      previousValue: "35.00",
      changePercent: variant.changePercent,
    },
    activeAlerts: {
      value: variant.activeAlerts,
      previousValue: Math.max(0, variant.activeAlerts - 1),
      changePercent: null,
    },
  };
};

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

const overviewResponse = (period: AnalyticsPeriod, locationId: string | null) => {
  const variant = analyticsVariant(period, locationId);
  const buckets =
    period === "today"
      ? ["2026-01-07T09", "2026-01-07T10", "2026-01-07T11"]
      : ["2026-01-05", "2026-01-06", "2026-01-07"];
  return {
    data: {
      period,
      locationId,
      window: periodWindow,
      kpis: kpis(period, locationId),
      trend: buckets.map((bucket, index) => ({
        bucket,
        revenue: (
          Number(variant.revenue) *
          (period === "30d" ? [0.1, 0.6, 0.3] : [0.18, 0.27, 0.55])[index]!
        ).toFixed(2),
        grossProfit: (Number(variant.grossProfit) * [0.5, 0.15, 0.35][index]!).toFixed(2),
        comparisonRevenue: (
          Number(variant.revenue) * [0.24, locationId === centralId ? 0.51 : 0.31, 0.25][index]!
        ).toFixed(2),
        comparisonGrossProfit: (
          Number(variant.grossProfit) * [0.2, period === "30d" ? 0.6 : 0.35, 0.2][index]!
        ).toFixed(2),
      })),
      goal: {
        month: "2026-01",
        revenue: variant.revenue,
        target: (Number(variant.revenue) * 2).toFixed(2),
        version: 1,
        completionPercent: "50.00",
        scope: "network",
      },
      locations: [
        {
          locationId: centralId,
          name: "Central",
          revenue: variant.revenue,
          grossProfit: variant.grossProfit,
          orders: variant.orders,
          activeAlerts: variant.activeAlerts,
        },
      ],
      topProducts: [
        {
          productId,
          name: `${variant.label} Top`,
          categoryName: "Coffee",
          unitsSold: `${variant.orders}.000`,
          revenue: variant.revenue,
          grossProfit: variant.grossProfit,
          grossMargin: "40.00",
          revenueShare: "60.00",
        },
      ],
      bottomProducts: [
        {
          productId: airportId,
          name: `${variant.label} Watch`,
          categoryName: "Bakery",
          unitsSold: "1.000",
          revenue: variant.averageCheck,
          grossProfit: (Number(variant.averageCheck) * 0.4).toFixed(2),
          grossMargin: "40.00",
          revenueShare: "5.00",
        },
      ],
      stockSummary: {
        inStock: variant.orders,
        lowStock: variant.seed,
        outOfStock: variant.activeAlerts,
      },
      alerts: [
        {
          id: alertId,
          type: "LOW_STOCK",
          locationId: centralId,
          locationName: variant.label,
          entityId: productId,
          entityName: `${variant.label} Beans`,
          currentValue: "1.000",
          previousValue: "2.000",
          threshold: "3.000",
        },
      ],
    } satisfies OverviewData,
    meta: meta(period, locationId),
    requestId,
  };
};

const locationsResponse = (
  period: AnalyticsPeriod,
  locationId: string | null,
  sortBy: LocationsData["sortBy"],
  sortDir: LocationsData["sortDir"],
) => {
  const central = {
    locationId: centralId,
    name: "Central",
    kpis: kpis(period, locationId),
    performance: "best",
  } as const;
  const airport = {
    locationId: airportId,
    name: "Airport",
    kpis: kpis(period, airportId),
    performance: "weak",
  } as const;
  return {
    data: {
      period,
      locationId,
      window: periodWindow,
      sortBy,
      sortDir,
      locations: locationId === centralId ? [central] : [central, airport],
    } satisfies LocationsData,
    meta: meta(period, locationId, sortBy, sortDir),
    requestId,
  };
};

test("updates Overview and Locations from the same location and period filters", async ({
  page,
}) => {
  let activeProfile: Profile = { ...profile, demoDataStale: true };
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
    const period = (url.searchParams.get("period") ?? "today") as AnalyticsPeriod;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(overviewResponse(period, url.searchParams.get("locationId"))),
    });
  });
  await page.route("**/api/v1/locations?*", (route) => {
    const url = new URL(route.request().url());
    const period = (url.searchParams.get("period") ?? "today") as AnalyticsPeriod;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        locationsResponse(
          period,
          url.searchParams.get("locationId"),
          (url.searchParams.get("sortBy") ?? "revenue") as LocationsData["sortBy"],
          (url.searchParams.get("sortDir") ?? "desc") as LocationsData["sortDir"],
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
  await expect(page.getByText("Network 7d Top")).toBeVisible();
  const initialTrendLines = page.locator(".recharts-line-curve");
  await expect(initialTrendLines).toHaveCount(4);
  await expect(initialTrendLines.nth(0)).toHaveAttribute("d", /.+/);
  await expect(initialTrendLines.nth(2)).toHaveAttribute("d", /.+/);
  const initialCurrentTrend = await initialTrendLines.nth(0).getAttribute("d");
  const initialComparisonTrend = await initialTrendLines.nth(2).getAttribute("d");

  const centralOverviewResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/overview" &&
      url.searchParams.get("period") === "7d" &&
      url.searchParams.get("locationId") === centralId
    );
  });
  await page.getByRole("combobox", { name: "Location", exact: true }).selectOption(centralId);
  await centralOverviewResponse;
  await expect.poll(() => new URL(page.url()).searchParams.get("locationId")).toBe(centralId);
  await expect(page.getByText("Central 7d Top")).toBeVisible();

  const centralLocationsResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/locations" &&
      url.searchParams.get("period") === "7d" &&
      url.searchParams.get("locationId") === centralId &&
      url.searchParams.get("sortBy") === "revenue" &&
      url.searchParams.get("sortDir") === "desc"
    );
  });
  await page.getByRole("link", { name: "Locations" }).click();
  await centralLocationsResponse;
  await expect(page.getByRole("heading", { name: "Locations" })).toBeVisible();
  const centralRow = page.getByRole("row").filter({
    has: page.getByText("Central", { exact: true }),
  });
  await expect(centralRow).toContainText(/KZT\s*2,000\.00/);

  const thirtyDayOverviewResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/overview" &&
      url.searchParams.get("period") === "30d" &&
      url.searchParams.get("locationId") === centralId
    );
  });
  const thirtyDayLocationsResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/locations" &&
      url.searchParams.get("period") === "30d" &&
      url.searchParams.get("locationId") === centralId &&
      url.searchParams.get("sortBy") === "revenue" &&
      url.searchParams.get("sortDir") === "desc"
    );
  });
  await page.getByRole("combobox", { name: "Period", exact: true }).selectOption("30d");
  await Promise.all([thirtyDayOverviewResponse, thirtyDayLocationsResponse]);
  await expect.poll(() => new URL(page.url()).searchParams.get("period")).toBe("30d");
  await expect(centralRow).toContainText(/KZT\s*4,300\.00/);
  await expect(centralRow).toContainText(/KZT\s*1,720\.00/);
  await expect(centralRow).toContainText(/KZT\s*100\.00/);
  await expect(centralRow).toContainText(/40\.0%/);
  await expect(page.getByRole("button", { name: "Active alerts: 4" })).toBeVisible();

  await page.getByRole("combobox", { name: "Sort by", exact: true }).selectOption("grossProfit");
  await expect.poll(() => new URL(page.url()).searchParams.get("sortBy")).toBe("grossProfit");

  await page.getByRole("link", { name: "Overview" }).click();
  const overview = page.getByTestId("page-overview");
  await expect(overview.getByRole("heading", { name: "Overview" })).toBeVisible();
  const metricCard = (name: string) =>
    overview
      .locator("article")
      .filter({ has: page.getByText(name, { exact: true }) })
      .first();
  const metricExpectations: Array<[string, RegExp]> = [
    ["Revenue", /KZT\s*4,300\.00/],
    ["Gross profit", /KZT\s*1,720\.00/],
    ["Orders", /Orders\s*43/],
    ["Average check", /KZT\s*100\.00/],
    ["Gross margin", /40\.0%/],
    ["Active alerts", /Active alerts\s*4/],
  ];
  for (const [name, value] of metricExpectations) {
    await expect(metricCard(name)).toContainText(value);
  }
  for (const name of ["Revenue", "Gross profit", "Orders", "Average check", "Gross margin"]) {
    await expect(metricCard(name).getByLabel("Increase of 40.0%")).toBeVisible();
  }

  const finalTrendLines = page.locator(".recharts-line-curve");
  await expect(finalTrendLines).toHaveCount(4);
  const trend = page.locator("figure[aria-labelledby='trend-title']");
  await expect(trend).toContainText("Revenue · Previous period");
  await expect(trend).toContainText("Gross profit · Previous period");
  await expect.poll(() => finalTrendLines.nth(0).getAttribute("d")).not.toBe(initialCurrentTrend);
  await expect
    .poll(() => finalTrendLines.nth(2).getAttribute("d"))
    .not.toBe(initialComparisonTrend);
  await expect(overview.locator("article[aria-labelledby='goal-title']")).toContainText(
    /KZT\s*4,300\.00\s*\/\s*KZT\s*8,600\.00/,
  );
  await expect(
    overview.locator("article[aria-labelledby='location-comparison-title']"),
  ).toContainText(/Central[\s\S]*KZT\s*4,300\.00/);
  await expect(overview.getByText("Central 30d Top")).toBeVisible();
  await expect(overview.getByText("Central 30d Watch")).toBeVisible();
  const stockSummary = overview.locator("article[aria-labelledby='stock-summary-title']");
  await expect(stockSummary).toContainText(/In stock\s*43/);
  await expect(stockSummary).toContainText(/Low stock\s*40/);
  await expect(stockSummary).toContainText(/Out of stock\s*4/);
  const recentAlerts = overview.locator("article[aria-labelledby='recent-alerts-title']");
  await expect(recentAlerts).toContainText("Central 30d · Central 30d Beans");
});

test("keeps populated analytics readable without horizontal overflow on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { authenticated: true, profile },
        meta: {},
        requestId,
      }),
    }),
  );
  await page.route("**/api/v1/overview?*", (route) => {
    const url = new URL(route.request().url());
    const period = (url.searchParams.get("period") ?? "today") as AnalyticsPeriod;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(overviewResponse(period, url.searchParams.get("locationId"))),
    });
  });
  await page.route("**/api/v1/locations?*", (route) => {
    const url = new URL(route.request().url());
    const period = (url.searchParams.get("period") ?? "today") as AnalyticsPeriod;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        locationsResponse(
          period,
          url.searchParams.get("locationId"),
          (url.searchParams.get("sortBy") ?? "revenue") as LocationsData["sortBy"],
          (url.searchParams.get("sortDir") ?? "desc") as LocationsData["sortDir"],
        ),
      ),
    });
  });

  await page.goto("/app/overview?period=7d");
  const overview = page.getByTestId("page-overview");
  await expect(overview.getByRole("heading", { name: "Overview" })).toBeVisible();
  const metricCards = [
    "Revenue",
    "Gross profit",
    "Orders",
    "Average check",
    "Gross margin",
    "Active alerts",
  ].map((name) =>
    overview
      .locator("article")
      .filter({ has: page.getByText(name, { exact: true }) })
      .first(),
  );
  const mobileRects = await Promise.all(metricCards.map((card) => card.boundingBox()));
  expect(mobileRects.every((rect) => rect !== null)).toBe(true);
  expect(new Set(mobileRects.map((rect) => Math.round(rect!.x))).size).toBe(1);
  expect(mobileRects.every((rect) => rect!.width <= 320)).toBe(true);
  const assertNoHorizontalOverflow = async () => {
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const chart = await page.locator("figure[aria-labelledby='trend-title']").boundingBox();
    expect(chart).not.toBeNull();
    expect(chart!.x + chart!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  };
  await assertNoHorizontalOverflow();

  await page.setViewportSize({ width: 720, height: 900 });
  const wideMobileRects = await Promise.all(
    metricCards.slice(0, 3).map((card) => card.boundingBox()),
  );
  expect(Math.round(wideMobileRects[0]!.y)).toBe(Math.round(wideMobileRects[1]!.y));
  expect(Math.round(wideMobileRects[0]!.x)).not.toBe(Math.round(wideMobileRects[1]!.x));
  expect(wideMobileRects[2]!.y).toBeGreaterThan(wideMobileRects[0]!.y);
  await assertNoHorizontalOverflow();

  await page.setViewportSize({ width: 320, height: 900 });
  await page.getByLabel("Open navigation").click();
  await page.getByRole("dialog").getByRole("link", { name: "Locations" }).click();
  const centralCard = page.locator("article").filter({
    has: page.getByRole("heading", { name: "Central" }),
  });
  await expect(centralCard).toContainText(/KZT\s*1,000\.00/);
  const locationMetrics = centralCard.locator("dl > div");
  await expect(locationMetrics).toHaveCount(6);
  const locationRects = await Promise.all([
    locationMetrics.nth(0).boundingBox(),
    locationMetrics.nth(1).boundingBox(),
    locationMetrics.nth(2).boundingBox(),
  ]);
  expect(Math.round(locationRects[0]!.y)).toBe(Math.round(locationRects[1]!.y));
  expect(Math.round(locationRects[0]!.x)).not.toBe(Math.round(locationRects[1]!.x));
  expect(locationRects[2]!.y).toBeGreaterThan(locationRects[0]!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
