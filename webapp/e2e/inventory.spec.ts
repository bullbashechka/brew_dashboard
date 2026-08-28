import { expect, test, type Page } from "./fixtures";

const requestId = "123e4567-e89b-12d3-a456-426614174099";
const networkId = "123e4567-e89b-12d3-a456-426614174001";
const itemId = "123e4567-e89b-12d3-a456-426614174012";
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

const window = {
  start: "2026-01-01T00:00:00.000Z",
  end: "2026-01-08T00:00:00.000Z",
  comparisonStart: "2025-12-25T00:00:00.000Z",
  comparisonEnd: "2026-01-01T00:00:00.000Z",
};

const meta = (
  pagination = { mode: "none", page: null, pageSize: null, nextCursor: null, pageContext: null },
) => ({
  asOf: "2026-01-07T12:00:00.000Z",
  demoDataRevision: 1,
  appliedFilters: { period: "today", locationId: null, status: null, sortBy: null, sortDir: null },
  warnings: [],
  pagination,
});

const installRoutes = async (page: Page, conflictFirstMovement = false) => {
  let onHand = "0.000";
  let shouldConflict = conflictFirstMovement;
  const movements: Array<{ id: string; type: "receipt" | "writeoff"; quantity: string }> = [];
  const isOut = () => onHand === "0.000";
  const alert = () => ({
    id: "123e4567-e89b-12d3-a456-426614174013",
    type: "OUT_OF_STOCK",
    locationId,
    locationName: "Central",
    entityId: itemId,
    entityName: "Coffee beans",
    currentValue: onHand,
    previousValue: null,
    threshold: "1.000",
  });
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { authenticated: true, profile }, meta: {}, requestId }),
    }),
  );
  await page.route("**/api/v1/locations?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          period: "today",
          locationId: null,
          window,
          sortBy: "revenue",
          sortDir: "desc",
          locations: [
            {
              locationId,
              name: "Central",
              kpis: {
                revenue: { value: "0.00", previousValue: "0.00", changePercent: null },
                grossProfit: { value: "0.00", previousValue: "0.00", changePercent: null },
                orders: { value: 0, previousValue: 0, changePercent: null },
                averageCheck: { value: null, previousValue: null, changePercent: null },
                grossMargin: { value: null, previousValue: null, changePercent: null },
                activeAlerts: { value: isOut() ? 1 : 0, previousValue: 0, changePercent: null },
              },
              performance: "standard",
            },
          ],
        },
        meta: meta(),
        requestId,
      }),
    }),
  );
  await page.route("**/api/v1/overview?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          period: "today",
          locationId: null,
          window,
          kpis: {
            revenue: { value: "0.00", previousValue: "0.00", changePercent: null },
            grossProfit: { value: "0.00", previousValue: "0.00", changePercent: null },
            orders: { value: 0, previousValue: 0, changePercent: null },
            averageCheck: { value: null, previousValue: null, changePercent: null },
            grossMargin: { value: null, previousValue: null, changePercent: null },
            activeAlerts: { value: isOut() ? 1 : 0, previousValue: 0, changePercent: null },
          },
          trend: [],
          goal: null,
          locations: [],
          topProducts: [],
          bottomProducts: [],
          stockSummary: { inStock: isOut() ? 0 : 1, lowStock: 0, outOfStock: isOut() ? 1 : 0 },
          alerts: isOut() ? [alert()] : [],
        },
        meta: meta(),
        requestId,
      }),
    }),
  );
  await page.route("**/api/v1/inventory?*", (route) => {
    const status = new URL(route.request().url()).searchParams.get("status");
    const currentStatus = isOut() ? "out_of_stock" : "in_stock";
    const matchesStatus = !status || status === currentStatus;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          period: "today",
          locationId: null,
          window,
          status,
          balances: matchesStatus
            ? [
                {
                  inventoryItemId: itemId,
                  inventoryItemName: "Coffee beans",
                  productId: null,
                  productName: null,
                  locationId,
                  locationName: "Central",
                  unit: "kg",
                  onHand,
                  minThreshold: "1.000",
                  status: currentStatus,
                },
              ]
            : [],
          movements: movements.map((movement) => ({
            movementId: movement.id,
            inventoryItemId: itemId,
            inventoryItemName: "Coffee beans",
            locationId,
            locationName: "Central",
            type: movement.type,
            quantity: movement.quantity,
            occurredAt: "2026-01-07T12:00:00.000Z",
          })),
          alerts: isOut() ? [alert()] : [],
        },
        meta: meta({
          mode: "cursor",
          page: null,
          pageSize: 20,
          nextCursor: null,
          pageContext: null,
        }),
        requestId,
      }),
    });
  });
  await page.route("**/api/v1/inventory/movements", async (route) => {
    const body = route.request().postDataJSON() as {
      type: "receipt" | "writeoff";
      quantity: string;
    };
    if (shouldConflict) {
      shouldConflict = false;
      onHand = "2.000";
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "CONFLICT", fields: {}, message: "Balance changed" },
          requestId,
        }),
      });
      return;
    }
    onHand = body.type === "receipt" ? body.quantity : "0.000";
    const id = `123e4567-e89b-12d3-a456-4266141740${movements.length + 20}`;
    movements.unshift({ id, type: body.type, quantity: body.quantity });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          movement: {
            movementId: id,
            inventoryItemId: itemId,
            inventoryItemName: "Coffee beans",
            locationId,
            locationName: "Central",
            type: body.type,
            quantity: body.quantity,
            occurredAt: "2026-01-07T12:00:00.000Z",
          },
          balance: {
            inventoryItemId: itemId,
            inventoryItemName: "Coffee beans",
            productId: null,
            productName: null,
            locationId,
            locationName: "Central",
            unit: "kg",
            onHand,
            minThreshold: "1.000",
            status: isOut() ? "out_of_stock" : "in_stock",
          },
          demoDataRevision: 1,
        },
        meta: {},
        requestId,
      }),
    });
  });
};

test("records receipt and write off with live stock alert updates", async ({ page }) => {
  await installRoutes(page);
  await page.goto("/app/inventory?period=today");
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Active alerts: 1" })).toBeVisible();

  await page.getByRole("button", { name: "Receipt" }).click();
  await page.getByLabel("Quantity").fill("2");
  await page.getByRole("button", { name: "Record receipt" }).click();
  await expect(page.getByText("Receipt recorded.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Active alerts: 0" })).toBeVisible();

  await page.getByRole("button", { name: "Write off" }).click();
  await page.getByLabel("Quantity").fill("2");
  await page.getByRole("button", { name: "Write off 2 kg" }).click();
  await expect(page.getByText("Write off recorded.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Active alerts: 1" })).toBeVisible();
});

test("keeps a conflicted form available outside its status filter and retries with fresh data", async ({
  page,
  browserFailureGuard,
}) => {
  browserFailureGuard.allowHttpError({
    method: "POST",
    url: /\/api\/v1\/inventory\/movements$/u,
    status: 409,
  });
  await installRoutes(page, true);
  await page.goto("/app/inventory?period=today&status=out_of_stock");
  await page.getByRole("button", { name: "Receipt" }).click();
  await page.getByLabel("Quantity").fill("2");
  const conflictResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/inventory/movements",
  );
  await page.getByRole("button", { name: "Record receipt" }).click();
  expect((await conflictResponse).status()).toBe(409);

  await expect(
    page.getByText("This information changed. Please refresh and try again."),
  ).toBeVisible();
  await expect(page.getByLabel("Quantity")).toHaveValue("2");
  await expect(page.getByText("Current balance: 2 kg")).toBeVisible();
  await expect(page).toHaveURL(/status=out_of_stock/);

  await page.getByRole("button", { name: "Retry with latest balance" }).click();
  await expect(page.getByText("Receipt recorded.")).toBeVisible();
});
