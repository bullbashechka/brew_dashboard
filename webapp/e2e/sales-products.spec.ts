import { expect, openAppSection, test, type Page } from "./fixtures";

const requestId = "123e4567-e89b-12d3-a456-426614174099";
const networkId = "123e4567-e89b-12d3-a456-426614174001";
const productId = "123e4567-e89b-12d3-a456-426614174012";
const locationId = "123e4567-e89b-12d3-a456-426614174010";
const profile = {
  userId: "123e4567-e89b-12d3-a456-426614174000",
  login: "demo.owner",
  networkId,
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

const metric = (value: string) => ({ value, previousValue: value, changePercent: "0.00" });
const meta = (
  pagination = { mode: "none", page: null, pageSize: null, nextCursor: null, pageContext: null },
) => ({
  asOf: "2026-01-07T12:00:00.000Z",
  demoDataRevision: 1,
  appliedFilters: { period: "7d", locationId: null, status: null, sortBy: null, sortDir: null },
  warnings: [],
  pagination,
});

const overview = () => ({
  data: {
    period: "7d",
    locationId: null,
    window: {
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-01-08T00:00:00.000Z",
      comparisonStart: "2025-12-25T00:00:00.000Z",
      comparisonEnd: "2026-01-01T00:00:00.000Z",
    },
    kpis: {
      revenue: metric("100.00"),
      grossProfit: metric("40.00"),
      orders: { value: 1, previousValue: 1, changePercent: "0.00" },
      averageCheck: metric("100.00"),
      grossMargin: metric("40.00"),
      activeAlerts: { value: 0, previousValue: 0, changePercent: null },
    },
    trend: [],
    goal: null,
    locations: [],
    topProducts: [],
    bottomProducts: [],
    stockSummary: { inStock: 1, lowStock: 0, outOfStock: 0 },
    alerts: [],
  },
  meta: meta(),
  requestId,
});

const locations = () => ({
  data: {
    period: "7d",
    locationId: null,
    window: overview().data.window,
    sortBy: "revenue",
    sortDir: "desc",
    locations: [
      { locationId, name: "Central", kpis: overview().data.kpis, performance: "standard" },
    ],
  },
  meta: meta(),
  requestId,
});

const sales = (cursor: boolean) => ({
  data: {
    period: "7d",
    locationId: null,
    window: overview().data.window,
    kpis: {
      revenue: metric("100.00"),
      cogs: metric("60.00"),
      grossProfit: metric("40.00"),
      grossMargin: metric("40.00"),
      orders: { value: 1, previousValue: 1, changePercent: "0.00" },
      averageCheck: metric("100.00"),
    },
    dailySeries: [
      {
        bucket: "2026-01-07",
        revenue: "100.00",
        grossProfit: "40.00",
        comparisonRevenue: "100.00",
        comparisonGrossProfit: "40.00",
      },
    ],
    heatmap: [{ weekday: 3, hour: 10, revenue: "100.00", orders: 1 }],
    peakHours: [{ weekday: 3, hour: 10, orders: 1 }],
    locations: [
      {
        id: locationId,
        name: "Central",
        revenue: "100.00",
        grossProfit: "40.00",
        orders: 1,
        unitsSold: "1.000",
      },
    ],
    categories: [
      {
        id: "123e4567-e89b-12d3-a456-426614174013",
        name: "Coffee",
        revenue: "100.00",
        grossProfit: "40.00",
        orders: 1,
        unitsSold: "1.000",
      },
    ],
    products: [
      {
        id: productId,
        name: "House Latte",
        revenue: "100.00",
        grossProfit: "40.00",
        orders: 1,
        unitsSold: "1.000",
      },
    ],
    recentOrders: cursor
      ? []
      : [
          {
            orderId: "123e4567-e89b-12d3-a456-426614174014",
            locationId,
            locationName: "Central",
            occurredAt: "2026-01-07T10:00:00.000Z",
            status: "completed",
            total: "100.00",
            items: [
              {
                productId,
                productName: "House Latte",
                quantity: "1.000",
                unitPriceAtSale: "100.00",
                lineRevenue: "100.00",
              },
            ],
          },
        ],
  },
  meta: meta({
    mode: "cursor",
    page: null,
    pageSize: 10,
    nextCursor: cursor ? null : "cursor-2",
    pageContext: null,
  }),
  requestId,
});

const installRoutes = async (page: Page) => {
  let price = "6.50";
  let version = 1;
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
      body: JSON.stringify(overview()),
    }),
  );
  await page.route("**/api/v1/locations?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(locations()),
    }),
  );
  await page.route("**/api/v1/sales?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        sales(Boolean(new URL(route.request().url()).searchParams.get("cursor"))),
      ),
    }),
  );
  await page.route("**/api/v1/products?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          period: "7d",
          locationId: null,
          window: overview().data.window,
          medians: { unitsSold: "1.000", unitContribution: "4.10" },
          categories: [{ categoryId: "123e4567-e89b-12d3-a456-426614174013", name: "Coffee" }],
          products: [
            {
              productId,
              name: "House Latte",
              categoryId: "123e4567-e89b-12d3-a456-426614174013",
              categoryName: "Coffee",
              active: true,
              currentPrice: price,
              currentUnitCost: "2.40",
              unitContribution: (Number(price) - 2.4).toFixed(2),
              currentUnitMargin: (((Number(price) - 2.4) / Number(price)) * 100).toFixed(2),
              version,
              unitsSold: "1.000",
              revenue: "100.00",
              grossProfit: "40.00",
              grossMargin: "40.00",
              revenueShare: "100.00",
              balances: [
                { locationId, locationName: "Central", onHand: "4.000", status: "in_stock" },
              ],
              menuGroup: "stars",
              recommendation: "protect_and_promote",
            },
          ],
        },
        meta: meta(),
        requestId,
      }),
    }),
  );
  await page.route(`**/api/v1/products/${productId}/price`, async (route) => {
    const body = route.request().postDataJSON();
    price = body.price;
    version += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          productId,
          currentPrice: price,
          currentUnitCost: "2.40",
          unitContribution: (Number(price) - 2.4).toFixed(2),
          currentUnitMargin: (((Number(price) - 2.4) / Number(price)) * 100).toFixed(2),
          version,
          demoDataRevision: 1,
        },
        meta: {},
        requestId,
      }),
    });
  });
};

const expectNoPageOverflow = async (page: Page) => {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
};

test("updates current product pricing without changing mocked historical sales", async ({
  page,
}) => {
  await installRoutes(page);

  await page.goto("/app/products?period=7d");
  await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
  await page.getByRole("button", { name: "Edit price" }).click();
  await page.getByLabel("Selling price").fill("9.99");
  await page.getByRole("button", { name: "Save price" }).click();
  await expect(
    page
      .getByTestId("page-products")
      .getByText(/KZT\s*9\.99/)
      .filter({ visible: true }),
  ).toBeVisible();
  await openAppSection(page, "Sales");
  // Sales can be this worker's first lazy-loaded route while the shared Vite
  // server is cold. Wait for route readiness rather than treating transform
  // latency as a failed pricing journey.
  await expect(page.getByRole("heading", { name: "Sales", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/KZT\s*100\.00/).first()).toBeVisible();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByRole("button", { name: "Load more" })).toBeHidden();
  await page.setViewportSize({ width: 320, height: 900 });
  await expectNoPageOverflow(page);
});

test("keeps heatmap, matrix, and data views accessible across desktop and mobile", async ({
  page,
}) => {
  await installRoutes(page);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto("/app/products?period=7d");
  const productsPage = page.getByTestId("page-products");
  const matrix = productsPage.locator("section[aria-labelledby='menu-matrix-title']");
  // A cold Vite server can take longer than the default assertion window to
  // transform the lazily loaded Products route while four browser workers open
  // their first routes. This is an initial-render readiness wait, not a retry
  // of the journey itself.
  await expect(matrix.getByRole("heading", { name: "Menu engineering matrix" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(matrix.locator(".recharts-responsive-container")).toBeVisible();
  for (const group of ["Stars", "Workhorses", "Puzzles", "Dogs"]) {
    await expect(matrix.getByRole("heading", { name: group })).toBeVisible();
  }
  const productTable = productsPage.getByRole("table", { name: "Coffee" });
  await expect(productTable).toBeVisible();
  await expect(productTable.getByRole("columnheader", { name: "Current price" })).toBeVisible();
  await expect(productTable.getByRole("cell", { name: /House Latte/ })).toBeVisible();
  await expectNoPageOverflow(page);

  await page.goto("/app/sales?period=7d");
  const salesPage = page.getByTestId("page-sales");
  const heatmap = salesPage.locator("figure[aria-labelledby='sales-heatmap-title']");
  await expect(heatmap.getByText("Sales by weekday and hour", { exact: true })).toBeVisible();
  await expect(heatmap.getByRole("table")).toBeVisible();
  await expect(heatmap.getByRole("cell", { name: /10:00.*1 orders/i })).toBeVisible();
  const recentOrders = salesPage.locator("section[aria-labelledby='recent-orders-title']");
  const recentOrdersTable = recentOrders.locator("table");
  await expect(recentOrdersTable).toBeVisible();
  await expect(recentOrdersTable.getByRole("columnheader", { name: "Items" })).toBeVisible();
  await expectNoPageOverflow(page);

  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/app/products?period=7d");
  await expect(matrix.locator(".recharts-responsive-container")).toBeHidden();
  for (const group of ["Stars", "Workhorses", "Puzzles", "Dogs"]) {
    await expect(matrix.getByRole("heading", { name: group })).toBeVisible();
  }
  await expect(productTable).toBeHidden();
  await expect(productsPage.getByRole("heading", { name: "House Latte" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.goto("/app/sales?period=7d");
  await expect(heatmap.getByRole("table")).toBeVisible();
  const heatmapScroll = await heatmap.getByRole("table").evaluate((table) => {
    const container = table.parentElement;
    if (!container) return null;
    return { clientWidth: container.clientWidth, scrollWidth: container.scrollWidth };
  });
  expect(heatmapScroll).not.toBeNull();
  expect(heatmapScroll!.scrollWidth).toBeGreaterThan(heatmapScroll!.clientWidth);
  expect(
    await heatmap.getByRole("table").evaluate((table) => {
      const container = table.parentElement;
      if (!container) return false;
      container.scrollLeft = 100;
      return container.scrollLeft > 0;
    }),
  ).toBe(true);
  await expect(recentOrdersTable).toBeHidden();
  await expect(recentOrders.getByRole("article").filter({ hasText: "House Latte" })).toBeVisible();
  await expectNoPageOverflow(page);
});
