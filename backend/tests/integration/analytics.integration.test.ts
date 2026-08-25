import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  apiErrorResponseSchema,
  inventoryResponseSchema,
  locationsResponseSchema,
  overviewResponseSchema,
  productsResponseSchema,
  salesResponseSchema,
} from "@brew-dashboard/contracts";
import { Client } from "pg";

import { createAccount, deleteAccount } from "../../src/admin/accounts.ts";
import { SESSION_COOKIE_NAME } from "../../src/auth/better-auth.ts";
import { __test as authHttpTest } from "../../src/auth/http.ts";
import { app } from "../../src/index.ts";
import { withRequestDatabase } from "../../src/db/client.ts";

const ownerUrl = process.env.DATABASE_TEST_URL;
const runtimeUrl = process.env.DATABASE_TEST_RUNTIME_URL;
const baseUrl = process.env.BETTER_AUTH_URL ?? "https://brew-dashboard.test";
const secret = process.env.BETTER_AUTH_SECRET ?? "stage5-integration-secret-".padEnd(32, "x");
const environment = {
  HYPERDRIVE: { connectionString: runtimeUrl ?? "" } as Hyperdrive,
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: baseUrl,
};

type TestAccount = Awaited<ReturnType<typeof createAccount>>;
const describeIntegration = describe.skipIf(!ownerUrl || !runtimeUrl);

describeIntegration("Stage 5 analytics API", () => {
  const ownerClient = new Client({ connectionString: ownerUrl });
  const accounts: TestAccount[] = [];

  const request = async (path: string, cookie: string, ip = "198.51.100.80") => {
    const headers = new Headers({ cookie, "cf-connecting-ip": ip });
    return app.request(new URL(path, baseUrl), { headers }, environment);
  };

  const cookieFrom = (response: Response) =>
    authHttpTest
      .getSetCookieValues(response.headers)
      .find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`))
      ?.split(";", 1)[0];

  const createOnboarded = async (login: string, networkName: string) => {
    const account = await withRequestDatabase(ownerUrl!, (db) =>
      createAccount(db, { login, password: "Stage5-account-A1", accountKind: "e2e" }),
    );
    accounts.push(account);
    const loginResponse = await app.request(
      new URL("/api/v1/auth/login", baseUrl),
      {
        method: "POST",
        headers: new Headers({
          origin: baseUrl,
          "content-type": "application/json",
          "cf-connecting-ip": `198.51.100.${accounts.length + 80}`,
        }),
        body: JSON.stringify({ login: account.login, password: account.password }),
      },
      environment,
    );
    const cookie = cookieFrom(loginResponse);
    if (!cookie) throw new Error("Expected analytics session cookie");
    await app.request(
      new URL("/api/v1/onboarding/language", baseUrl),
      {
        method: "PUT",
        headers: new Headers({ origin: baseUrl, "content-type": "application/json", cookie }),
        body: JSON.stringify({ language: "en", idempotencyKey: crypto.randomUUID() }),
      },
      environment,
    );
    const completed = await app.request(
      new URL("/api/v1/onboarding/complete", baseUrl),
      {
        method: "POST",
        headers: new Headers({ origin: baseUrl, "content-type": "application/json", cookie }),
        body: JSON.stringify({
          networkName,
          ownerName: "Analytics Owner",
          locations: [{ name: "Central" }, { name: "Airport" }],
          country: "KZ",
          currency: "KZT",
          timeZone: "Asia/Almaty",
          idempotencyKey: crypto.randomUUID(),
        }),
      },
      environment,
    );
    expect(completed.status).toBe(200);
    return { account, cookie };
  };

  beforeAll(async () => {
    await ownerClient.connect();
  });

  afterAll(async () => {
    for (const account of accounts.reverse()) {
      try {
        await withRequestDatabase(ownerUrl!, (db) =>
          deleteAccount(db, {
            login: account.login,
            accountKind: "e2e",
          }),
        );
      } catch {
        // Cleanup must remain best-effort if a preceding assertion failed.
      }
    }
    await ownerClient.end();
  });

  it("serves schema-valid analytics with shared KPI values and tenant-safe location fallback", async () => {
    const first = await createOnboarded(
      `stage5-a-${crypto.randomUUID().slice(0, 8)}`,
      "Stage Five A",
    );
    const second = await createOnboarded(
      `stage5-b-${crypto.randomUUID().slice(0, 8)}`,
      "Stage Five B",
    );
    const foreignLocation = await ownerClient.query<{ id: string }>(
      "SELECT id::text AS id FROM app.locations WHERE network_id = $1 ORDER BY id LIMIT 1",
      [second.account.networkId],
    );
    const before = await ownerClient.query<{ products: string; orders: string }>(
      `SELECT
         (SELECT count(*)::text FROM app.products WHERE network_id = $1) AS products,
         (SELECT count(*)::text FROM app.orders WHERE network_id = $1) AS orders`,
      [first.account.networkId],
    );

    const [overview, locations, sales, products, inventory] = await Promise.all([
      request("/api/v1/overview?period=7d", first.cookie),
      request("/api/v1/locations?period=7d", first.cookie),
      request("/api/v1/sales?period=7d&page=1&pageSize=2", first.cookie),
      request("/api/v1/products?period=7d", first.cookie),
      request("/api/v1/inventory?period=7d&status=out_of_stock", first.cookie),
    ]);
    expect(overview.status).toBe(200);
    expect(locations.status).toBe(200);
    expect(sales.status).toBe(200);
    expect(products.status).toBe(200);
    expect(inventory.status).toBe(200);
    const overviewBody = overviewResponseSchema.parse(await overview.json());
    const locationsBody = locationsResponseSchema.parse(await locations.json());
    const salesBody = salesResponseSchema.parse(await sales.json());
    productsResponseSchema.parse(await products.json());
    inventoryResponseSchema.parse(await inventory.json());
    expect(overviewBody.data.kpis.revenue.value).toBe(salesBody.data.kpis.revenue.value);
    expect(overviewBody.data.kpis.grossProfit.value).toBe(salesBody.data.kpis.grossProfit.value);
    expect(locationsBody.data.locations.length).toBe(2);
    expect(overviewBody.meta.appliedFilters.period).toBe("7d");
    expect(overviewBody.meta.appliedFilters.locationId).toBeNull();
    expect(overviewBody.meta.warnings).toEqual([]);
    expect(salesBody.meta.pagination.mode).toBe("page");

    const fallback = await request(
      `/api/v1/overview?locationId=${foreignLocation.rows[0]!.id}`,
      first.cookie,
    );
    expect(fallback.status).toBe(200);
    const fallbackBody = overviewResponseSchema.parse(await fallback.json());
    expect(fallbackBody.data.locationId).toBeNull();
    expect(fallbackBody.meta.warnings).toEqual([
      { code: "INVALID_LOCATION_FALLBACK", field: "locationId" },
    ]);

    const malformed = await request("/api/v1/overview?locationId=not-a-uuid", first.cookie);
    expect(malformed.status).toBe(200);
    expect(overviewResponseSchema.parse(await malformed.json()).meta.warnings).toEqual([
      { code: "INVALID_LOCATION_FALLBACK", field: "locationId" },
    ]);

    const invalidPeriod = await request("/api/v1/overview?period=quarter", first.cookie);
    expect(invalidPeriod.status).toBe(400);
    expect(apiErrorResponseSchema.parse(await invalidPeriod.json()).error.code).toBe(
      "VALIDATION_ERROR",
    );

    const after = await ownerClient.query<{ products: string; orders: string }>(
      `SELECT
         (SELECT count(*)::text FROM app.products WHERE network_id = $1) AS products,
         (SELECT count(*)::text FROM app.orders WHERE network_id = $1) AS orders`,
      [first.account.networkId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("keeps cursor continuation stable and rejects a tampered token", async () => {
    const first = await createOnboarded(
      `stage5-page-${crypto.randomUUID().slice(0, 8)}`,
      "Stage Five Pagination",
    );
    const firstPage = salesResponseSchema.parse(
      await (await request("/api/v1/sales?period=6m&pageSize=2", first.cookie)).json(),
    );
    const cursor = firstPage.meta.pagination.nextCursor;
    if (!cursor) return;
    const secondPageResponse = await request(
      `/api/v1/sales?period=6m&pageSize=2&cursor=${encodeURIComponent(cursor)}`,
      first.cookie,
    );
    expect(secondPageResponse.status).toBe(200);
    const secondPage = salesResponseSchema.parse(await secondPageResponse.json());
    const firstIds = new Set(firstPage.data.recentOrders.map((order) => order.orderId));
    expect(secondPage.data.recentOrders.some((order) => firstIds.has(order.orderId))).toBe(false);
    const mismatchedPageSize = await request(
      `/api/v1/sales?period=6m&pageSize=3&cursor=${encodeURIComponent(cursor)}`,
      first.cookie,
    );
    expect(mismatchedPageSize.status).toBe(400);
    expect(apiErrorResponseSchema.parse(await mismatchedPageSize.json()).error.code).toBe(
      "VALIDATION_ERROR",
    );

    const inventoryFirstPage = inventoryResponseSchema.parse(
      await (await request("/api/v1/inventory?period=6m&pageSize=1", first.cookie)).json(),
    );
    const inventoryCursor = inventoryFirstPage.meta.pagination.nextCursor;
    if (inventoryCursor) {
      const mismatchedInventoryPageSize = await request(
        `/api/v1/inventory?period=6m&pageSize=2&cursor=${encodeURIComponent(inventoryCursor)}`,
        first.cookie,
      );
      expect(mismatchedInventoryPageSize.status).toBe(400);
      expect(
        apiErrorResponseSchema.parse(await mismatchedInventoryPageSize.json()).error.code,
      ).toBe("VALIDATION_ERROR");
    }
    const firstPageContextResponse = await request(
      "/api/v1/sales?period=6m&page=1&pageSize=2",
      first.cookie,
    );
    const firstPageContext = salesResponseSchema.parse(await firstPageContextResponse.json()).meta
      .pagination.pageContext;
    if (firstPageContext) {
      const mismatchedPageContext = await request(
        `/api/v1/sales?period=6m&page=2&pageSize=3&pageContext=${encodeURIComponent(firstPageContext)}`,
        first.cookie,
      );
      expect(mismatchedPageContext.status).toBe(400);
      expect(apiErrorResponseSchema.parse(await mismatchedPageContext.json()).error.code).toBe(
        "VALIDATION_ERROR",
      );
    }
    const tampered = `${cursor.slice(0, -2)}aa`;
    const invalid = await request(
      `/api/v1/sales?cursor=${encodeURIComponent(tampered)}`,
      first.cookie,
    );
    expect(invalid.status).toBe(400);
    expect(apiErrorResponseSchema.parse(await invalid.json()).error.code).toBe("VALIDATION_ERROR");
  }, 15_000);

  it("keeps the tenant/time range analytics reads explainable", async () => {
    const account = await createOnboarded(
      `stage5-explain-${crypto.randomUUID().slice(0, 8)}`,
      "Stage Five Explain",
    );
    const networkId = account.account.networkId;
    const [ordersPlan, movementsPlan] = await Promise.all([
      ownerClient.query(
        `EXPLAIN (FORMAT JSON, COSTS OFF)
         SELECT o.id
         FROM app.orders o
         WHERE o.network_id = '${networkId}'::uuid
           AND o.ordered_at >= now() - interval '7 days'
           AND o.ordered_at < now()`,
      ),
      ownerClient.query(
        `EXPLAIN (FORMAT JSON, COSTS OFF)
         SELECT m.id
         FROM app.inventory_movements m
         WHERE m.network_id = '${networkId}'::uuid
           AND m.occurred_at >= now() - interval '7 days'
           AND m.occurred_at < now()`,
      ),
    ]);
    const ordersPlanJson = ordersPlan.rows[0]?.["QUERY PLAN"];
    const movementsPlanJson = movementsPlan.rows[0]?.["QUERY PLAN"];
    expect(Array.isArray(ordersPlanJson)).toBe(true);
    expect(Array.isArray(movementsPlanJson)).toBe(true);
    expect((ordersPlanJson as Array<{ Plan?: unknown }>)[0]?.Plan).toBeDefined();
    expect((movementsPlanJson as Array<{ Plan?: unknown }>)[0]?.Plan).toBeDefined();
  });
});
