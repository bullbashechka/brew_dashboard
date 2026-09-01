import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  apiErrorResponseSchema,
  inventoryMovementMutationResponseSchema,
  inventoryResponseSchema,
  locationsResponseSchema,
  overviewResponseSchema,
  priceMutationResponseSchema,
  productsResponseSchema,
  resetResultResponseSchema,
  salesResponseSchema,
} from "@brew-dashboard/contracts";
import { Client } from "pg";

import { createAccount, deleteAccount } from "../../src/admin/accounts.ts";
import { SESSION_COOKIE_NAME } from "../../src/auth/better-auth.ts";
import { __test as authHttpTest } from "../../src/auth/http.ts";
import { app } from "../../src/index.ts";
import { setTenantContext, withRequestDatabase } from "../../src/db/client.ts";
import { createInventoryMovement } from "../../src/inventory/service.ts";

const ownerUrl = process.env.DATABASE_TEST_URL;
const runtimeUrl = process.env.DATABASE_TEST_RUNTIME_URL;
const baseUrl = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:4173";
const secret = process.env.BETTER_AUTH_SECRET ?? "stage5-integration-secret-".padEnd(32, "x");
const environment = {
  HYPERDRIVE: { connectionString: runtimeUrl ?? "" } as Hyperdrive,
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: baseUrl,
  MFA_REQUIRED: "0",
};

type TestAccount = Awaited<ReturnType<typeof createAccount>>;
const describeIntegration = describe.skipIf(!ownerUrl || !runtimeUrl);

describeIntegration("Stage 5 analytics API", () => {
  const ownerClient = new Client({ connectionString: ownerUrl });
  const accounts: TestAccount[] = [];

  const request = async (
    path: string,
    cookie: string,
    init: RequestInit = {},
    ip = "198.51.100.80",
  ) => {
    const headers = new Headers(init.headers);
    headers.set("cookie", cookie);
    headers.set("cf-connecting-ip", ip);
    return app.request(new URL(path, baseUrl), { ...init, headers }, environment);
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

  afterEach(async () => {
    for (const account of accounts.splice(0).reverse()) {
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
  }, 60_000);

  afterAll(async () => {
    await ownerClient.end();
  }, 60_000);

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
  }, 60_000);

  it("serves dashboard reads for ten concurrent authenticated sessions", async () => {
    const first = await createOnboarded(
      `stage5-concurrency-${crypto.randomUUID().slice(0, 8)}`,
      "Stage Five Concurrency",
    );
    const additionalCookies = await Promise.all(
      Array.from({ length: 9 }, async (_, index) => {
        const loginResponse = await app.request(
          new URL("/api/v1/auth/login", baseUrl),
          {
            method: "POST",
            headers: new Headers({
              origin: baseUrl,
              "content-type": "application/json",
              "cf-connecting-ip": `203.0.113.${index + 20}`,
            }),
            body: JSON.stringify({
              login: first.account.login,
              password: first.account.password,
            }),
          },
          environment,
        );
        expect(loginResponse.status).toBe(200);
        const cookie = cookieFrom(loginResponse);
        if (!cookie) throw new Error("Expected concurrent analytics session cookie");
        return cookie;
      }),
    );
    const cookies = [first.cookie, ...additionalCookies];

    const responses = await Promise.all(
      cookies.map(async (cookie, index) => {
        const ip = `203.0.113.${index + 40}`;
        const [overview, locations] = await Promise.all([
          request("/api/v1/overview?period=today", cookie, {}, ip),
          request("/api/v1/locations?period=today", cookie, {}, ip),
        ]);
        return { overview, locations };
      }),
    );

    for (const response of responses) {
      expect(response.overview.status).toBe(200);
      expect(response.locations.status).toBe(200);
      overviewResponseSchema.parse(await response.overview.json());
      locationsResponseSchema.parse(await response.locations.json());
    }
  }, 120_000);

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
  }, 60_000);

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

  it("records tenant-scoped inventory movements once and recomputes stock alerts", async () => {
    const first = await createOnboarded(
      `stage10-a-${crypto.randomUUID().slice(0, 8)}`,
      "Stage Ten A",
    );
    const second = await createOnboarded(
      `stage10-b-${crypto.randomUUID().slice(0, 8)}`,
      "Stage Ten B",
    );
    const initial = inventoryResponseSchema.parse(
      await (await request("/api/v1/inventory?period=today", first.cookie)).json(),
    );
    const foreign = inventoryResponseSchema.parse(
      await (await request("/api/v1/inventory?period=today", second.cookie)).json(),
    );
    const outOfStock = initial.data.balances.find((balance) => balance.status === "out_of_stock");
    const foreignBalance = foreign.data.balances[0];
    if (!outOfStock || !foreignBalance) throw new Error("Expected generated inventory balances");

    const quantity = (Number(outOfStock.minThreshold) + 1).toFixed(3);
    const mutation = {
      inventoryItemId: outOfStock.inventoryItemId,
      locationId: outOfStock.locationId,
      type: "receipt" as const,
      quantity,
      expectedDemoDataRevision: initial.meta.demoDataRevision,
      idempotencyKey: crypto.randomUUID(),
    };
    const receipt = await request("/api/v1/inventory/movements", first.cookie, {
      method: "POST",
      headers: { origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify(mutation),
    });
    expect(receipt.status).toBe(200);
    const created = inventoryMovementMutationResponseSchema.parse(await receipt.json());
    expect(created.data.movement.type).toBe("receipt");
    expect(created.data.balance.status).toBe("in_stock");

    const replay = await request("/api/v1/inventory/movements", first.cookie, {
      method: "POST",
      headers: { origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify(mutation),
    });
    expect(replay.status).toBe(200);
    expect(
      inventoryMovementMutationResponseSchema.parse(await replay.json()).data.movement.movementId,
    ).toBe(created.data.movement.movementId);

    const changedPayload = await request("/api/v1/inventory/movements", first.cookie, {
      method: "POST",
      headers: { origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify({ ...mutation, quantity: "1.000" }),
    });
    expect(changedPayload.status).toBe(409);

    const after = inventoryResponseSchema.parse(
      await (await request("/api/v1/inventory?period=today", first.cookie)).json(),
    );
    const updated = after.data.balances.find(
      (balance) =>
        balance.inventoryItemId === outOfStock.inventoryItemId &&
        balance.locationId === outOfStock.locationId,
    );
    expect(updated?.status).toBe("in_stock");
    expect(
      after.data.alerts.some(
        (alert) =>
          alert.entityId === outOfStock.inventoryItemId &&
          alert.locationId === outOfStock.locationId,
      ),
    ).toBe(false);
    expect(
      after.data.movements.some(
        (movement) => movement.movementId === created.data.movement.movementId,
      ),
    ).toBe(true);
    const overviewAfter = overviewResponseSchema.parse(
      await (await request("/api/v1/overview?period=today", first.cookie)).json(),
    );
    expect(
      overviewAfter.data.alerts.some(
        (alert) =>
          alert.entityId === outOfStock.inventoryItemId &&
          alert.locationId === outOfStock.locationId,
      ),
    ).toBe(false);

    const events = await ownerClient.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM app.product_events
       WHERE network_id = $1
         AND type = 'inventory_movement_created'
         AND metadata = $2::jsonb`,
      [
        first.account.networkId,
        JSON.stringify({
          inventoryItemId: outOfStock.inventoryItemId,
          locationId: outOfStock.locationId,
          type: "receipt",
        }),
      ],
    );
    expect(events.rows[0]?.count).toBe("1");

    const tooLarge = await request("/api/v1/inventory/movements", first.cookie, {
      method: "POST",
      headers: { origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify({
        ...mutation,
        type: "writeoff",
        quantity: "99999999999.000",
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    expect(tooLarge.status).toBe(409);
    expect(apiErrorResponseSchema.parse(await tooLarge.json()).error.code).toBe("CONFLICT");

    const crossTenant = await request("/api/v1/inventory/movements", first.cookie, {
      method: "POST",
      headers: { origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify({
        ...mutation,
        inventoryItemId: foreignBalance.inventoryItemId,
        locationId: foreignBalance.locationId,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    expect(crossTenant.status).toBe(404);
  }, 60_000);

  it("transitions stock alerts at exact thresholds and rejects stale inventory revisions", async () => {
    const account = await createOnboarded(
      `stage10-thresholds-${crypto.randomUUID().slice(0, 8)}`,
      "Stage Ten Thresholds",
    );
    const initial = inventoryResponseSchema.parse(
      await (await request("/api/v1/inventory?period=today", account.cookie)).json(),
    );
    const outOfStock = initial.data.balances.find((balance) => balance.status === "out_of_stock");
    if (!outOfStock) throw new Error("Expected generated out-of-stock balance");
    const movement = async (type: "receipt" | "writeoff", quantity: string) => {
      const response = await request("/api/v1/inventory/movements", account.cookie, {
        method: "POST",
        headers: { origin: baseUrl, "content-type": "application/json" },
        body: JSON.stringify({
          inventoryItemId: outOfStock.inventoryItemId,
          locationId: outOfStock.locationId,
          type,
          quantity,
          expectedDemoDataRevision: initial.meta.demoDataRevision,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      expect(response.status).toBe(200);
      return inventoryMovementMutationResponseSchema.parse(await response.json());
    };
    const alerts = async () =>
      inventoryResponseSchema.parse(
        await (await request("/api/v1/inventory?period=today", account.cookie)).json(),
      ).data.alerts;

    expect((await movement("receipt", outOfStock.minThreshold)).data.balance.status).toBe(
      "low_stock",
    );
    expect(
      (await alerts()).some(
        (alert) =>
          alert.type === "LOW_STOCK" &&
          alert.entityId === outOfStock.inventoryItemId &&
          alert.locationId === outOfStock.locationId,
      ),
    ).toBe(true);
    expect((await movement("receipt", "1.000")).data.balance.status).toBe("in_stock");
    expect(
      (await alerts()).some(
        (alert) =>
          alert.entityId === outOfStock.inventoryItemId &&
          alert.locationId === outOfStock.locationId,
      ),
    ).toBe(false);
    expect((await movement("writeoff", "1.000")).data.balance.status).toBe("low_stock");
    expect((await movement("writeoff", outOfStock.minThreshold)).data.balance.status).toBe(
      "out_of_stock",
    );

    const reset = await request("/api/v1/demo/reset", account.cookie, {
      method: "POST",
      headers: { origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
    });
    expect(reset.status).toBe(200);
    const staleKey = crypto.randomUUID();
    const stale = await request("/api/v1/inventory/movements", account.cookie, {
      method: "POST",
      headers: { origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify({
        inventoryItemId: outOfStock.inventoryItemId,
        locationId: outOfStock.locationId,
        type: "receipt",
        quantity: "1.000",
        expectedDemoDataRevision: initial.meta.demoDataRevision,
        idempotencyKey: staleKey,
      }),
    });
    expect(stale.status).toBe(409);
    const staleKeyRows = await ownerClient.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM app.idempotency_keys
       WHERE network_id = $1 AND key = $2`,
      [account.account.networkId, staleKey],
    );
    expect(staleKeyRows.rows[0]?.count).toBe("0");
  }, 60_000);

  it("rolls back inventory state when a post-movement step fails", async () => {
    const account = await createOnboarded(
      `stage10-rollback-${crypto.randomUUID().slice(0, 8)}`,
      "Stage Ten Rollback",
    );
    const initial = inventoryResponseSchema.parse(
      await (await request("/api/v1/inventory?period=today", account.cookie)).json(),
    );
    const balance = initial.data.balances[0];
    if (!balance) throw new Error("Expected generated inventory balance");
    const key = crypto.randomUUID();
    const snapshot = async () => {
      const result = await ownerClient.query<{
        onHand: string;
        movementCount: string;
        idempotencyCount: string;
        eventCount: string;
      }>(
        `SELECT b.on_hand::text AS "onHand",
                (SELECT count(*)::text
                   FROM app.inventory_movements m
                  WHERE m.network_id = $1
                    AND m.location_id = $2
                    AND m.inventory_item_id = $3) AS "movementCount",
                (SELECT count(*)::text
                   FROM app.idempotency_keys i
                  WHERE i.network_id = $1 AND i.key = $4) AS "idempotencyCount",
                (SELECT count(*)::text
                   FROM app.product_events e
                  WHERE e.network_id = $1 AND e.type = 'inventory_movement_created') AS "eventCount"
           FROM app.inventory_balances b
          WHERE b.network_id = $1 AND b.location_id = $2 AND b.inventory_item_id = $3`,
        [account.account.networkId, balance.locationId, balance.inventoryItemId, key],
      );
      return result.rows[0];
    };
    const before = await snapshot();

    await expect(
      withRequestDatabase(runtimeUrl!, (db) =>
        db.transaction(async (transaction) => {
          await setTenantContext(transaction, account.account.networkId);
          return createInventoryMovement(transaction, {
            authUserId: account.account.authUserId,
            networkId: account.account.networkId,
            request: {
              inventoryItemId: balance.inventoryItemId,
              locationId: balance.locationId,
              type: "receipt",
              quantity: "1.000",
              expectedDemoDataRevision: initial.meta.demoDataRevision,
              idempotencyKey: key,
            },
            hooks: {
              afterMovementApplied: () => {
                throw new Error("injected inventory post-movement failure");
              },
            },
          });
        }),
      ),
    ).rejects.toThrow("injected inventory post-movement failure");
    expect(await snapshot()).toEqual(before);
  }, 60_000);

  it("updates only the current product price and records one safe tenant event", async () => {
    const first = await createOnboarded(
      `stage9-a-${crypto.randomUUID().slice(0, 8)}`,
      "Stage Nine A",
    );
    const second = await createOnboarded(
      `stage9-b-${crypto.randomUUID().slice(0, 8)}`,
      "Stage Nine B",
    );
    const initialProducts = productsResponseSchema.parse(
      await (await request("/api/v1/products?period=30d", first.cookie)).json(),
    );
    const product = initialProducts.data.products[0];
    if (!product) throw new Error("Expected generated product");
    const foreignProducts = productsResponseSchema.parse(
      await (await request("/api/v1/products?period=30d", second.cookie)).json(),
    );
    const beforeSales = salesResponseSchema.parse(
      await (await request("/api/v1/sales?period=30d", first.cookie)).json(),
    );
    const beforeSnapshots = await ownerClient.query<{ checksum: string }>(
      `SELECT md5(coalesce(string_agg(
        order_id::text || ':' || product_id::text || ':' || unit_price_at_sale::text || ':' || unit_cost_at_sale::text,
        ',' ORDER BY id
      ), '')) AS checksum
       FROM app.order_items
       WHERE network_id = $1`,
      [first.account.networkId],
    );
    const mutation = {
      price: "999.00",
      expectedVersion: product.version,
      expectedDemoDataRevision: initialProducts.meta.demoDataRevision,
      idempotencyKey: crypto.randomUUID(),
    };
    const update = await request(`/api/v1/products/${product.productId}/price`, first.cookie, {
      method: "PATCH",
      headers: { origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify(mutation),
    });
    expect(update.status).toBe(200);
    const updated = priceMutationResponseSchema.parse(await update.json());
    expect(updated.data.currentPrice).toBe("999.00");
    expect(updated.data.version).toBe(product.version + 1);
    expect(updated.data.currentUnitMargin).not.toBeNull();

    const secondMutation = {
      price: "998.00",
      expectedVersion: updated.data.version,
      expectedDemoDataRevision: initialProducts.meta.demoDataRevision,
      idempotencyKey: crypto.randomUUID(),
    };
    const secondUpdate = await request(
      `/api/v1/products/${product.productId}/price`,
      first.cookie,
      {
        method: "PATCH",
        headers: { origin: baseUrl, "content-type": "application/json" },
        body: JSON.stringify(secondMutation),
      },
    );
    expect(secondUpdate.status).toBe(200);
    const secondResult = priceMutationResponseSchema.parse(await secondUpdate.json());
    expect(secondResult.data.currentPrice).toBe("998.00");
    expect(secondResult.data.version).toBe(updated.data.version + 1);

    const replay = await request(`/api/v1/products/${product.productId}/price`, first.cookie, {
      method: "PATCH",
      headers: { origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify(mutation),
    });
    expect(replay.status).toBe(200);
    const replayResult = priceMutationResponseSchema.parse(await replay.json());
    expect(replayResult.data.currentPrice).toBe("999.00");
    expect(replayResult.data.version).toBe(product.version + 1);

    const afterProducts = productsResponseSchema.parse(
      await (await request("/api/v1/products?period=30d", first.cookie)).json(),
    );
    const afterProduct = afterProducts.data.products.find(
      (value) => value.productId === product.productId,
    );
    expect(afterProduct?.currentPrice).toBe("998.00");
    expect(afterProduct?.version).toBe(secondResult.data.version);
    expect(afterProduct?.currentUnitMargin).toBe(secondResult.data.currentUnitMargin);
    const afterSales = salesResponseSchema.parse(
      await (await request("/api/v1/sales?period=30d", first.cookie)).json(),
    );
    expect(afterSales.data.kpis.revenue.value).toBe(beforeSales.data.kpis.revenue.value);
    expect(afterSales.data.kpis.grossProfit.value).toBe(beforeSales.data.kpis.grossProfit.value);
    const afterSnapshots = await ownerClient.query<{ checksum: string }>(
      `SELECT md5(coalesce(string_agg(
        order_id::text || ':' || product_id::text || ':' || unit_price_at_sale::text || ':' || unit_cost_at_sale::text,
        ',' ORDER BY id
      ), '')) AS checksum
       FROM app.order_items
       WHERE network_id = $1`,
      [first.account.networkId],
    );
    expect(afterSnapshots.rows[0]?.checksum).toBe(beforeSnapshots.rows[0]?.checksum);

    const events = await ownerClient.query<{ type: string; metadata: { productId: string } }>(
      `SELECT type::text, metadata
       FROM app.product_events
       WHERE network_id = $1
       ORDER BY occurred_at`,
      [first.account.networkId],
    );
    const priceEvents = events.rows.filter((event) => event.type === "product_price_changed");
    expect(priceEvents).toHaveLength(2);
    expect(priceEvents.map((event) => event.metadata)).toEqual([
      { productId: product.productId },
      { productId: product.productId },
    ]);

    const reusedKey = await request(`/api/v1/products/${product.productId}/price`, first.cookie, {
      method: "PATCH",
      headers: { origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify({ ...mutation, price: "997.00" }),
    });
    expect(reusedKey.status).toBe(409);

    const staleVersion = await request(
      `/api/v1/products/${product.productId}/price`,
      first.cookie,
      {
        method: "PATCH",
        headers: { origin: baseUrl, "content-type": "application/json" },
        body: JSON.stringify({
          price: "997.00",
          expectedVersion: product.version,
          expectedDemoDataRevision: initialProducts.meta.demoDataRevision,
          idempotencyKey: crypto.randomUUID(),
        }),
      },
    );
    expect(staleVersion.status).toBe(409);

    const noOpKey = crypto.randomUUID();
    const noOp = await request(`/api/v1/products/${product.productId}/price`, first.cookie, {
      method: "PATCH",
      headers: { origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify({
        price: "998.00",
        expectedVersion: secondResult.data.version,
        expectedDemoDataRevision: initialProducts.meta.demoDataRevision,
        idempotencyKey: noOpKey,
      }),
    });
    expect(noOp.status).toBe(409);
    const noOpKeyRows = await ownerClient.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM app.idempotency_keys
       WHERE network_id = $1 AND key = $2`,
      [first.account.networkId, noOpKey],
    );
    expect(noOpKeyRows.rows[0]?.count).toBe("0");

    const foreign = await request(
      `/api/v1/products/${foreignProducts.data.products[0]!.productId}/price`,
      first.cookie,
      {
        method: "PATCH",
        headers: { origin: baseUrl, "content-type": "application/json" },
        body: JSON.stringify({ ...mutation, idempotencyKey: crypto.randomUUID() }),
      },
    );
    expect(foreign.status).toBe(404);
  }, 60_000);

  it("rejects stale demo revisions and serializes concurrent price writes", async () => {
    const account = await createOnboarded(
      `stage9-concurrency-${crypto.randomUUID().slice(0, 8)}`,
      "Stage Nine Concurrency",
    );
    const initial = productsResponseSchema.parse(
      await (await request("/api/v1/products?period=30d", account.cookie)).json(),
    );
    const initialProduct = initial.data.products[0];
    if (!initialProduct) throw new Error("Expected generated product");

    const reset = await request("/api/v1/demo/reset", account.cookie, {
      method: "POST",
      headers: { origin: baseUrl, "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
    });
    expect(reset.status).toBe(200);
    const resetResult = resetResultResponseSchema.parse(await reset.json());
    expect(resetResult.data.profile.demoDataRevision).toBe(initial.meta.demoDataRevision + 1);

    const stale = await request(
      `/api/v1/products/${initialProduct.productId}/price`,
      account.cookie,
      {
        method: "PATCH",
        headers: { origin: baseUrl, "content-type": "application/json" },
        body: JSON.stringify({
          price: "999.00",
          expectedVersion: initialProduct.version,
          expectedDemoDataRevision: initial.meta.demoDataRevision,
          idempotencyKey: crypto.randomUUID(),
        }),
      },
    );
    expect(stale.status).toBe(409);
    expect(apiErrorResponseSchema.parse(await stale.json()).error.code).toBe("CONFLICT");

    const current = productsResponseSchema.parse(
      await (await request("/api/v1/products?period=30d", account.cookie)).json(),
    );
    const currentProduct = current.data.products.find(
      (product) => product.productId === initialProduct.productId,
    );
    if (!currentProduct) throw new Error("Expected reset product");
    const concurrentMutations = [
      {
        price: "701.00",
        expectedVersion: currentProduct.version,
        expectedDemoDataRevision: current.meta.demoDataRevision,
        idempotencyKey: crypto.randomUUID(),
      },
      {
        price: "702.00",
        expectedVersion: currentProduct.version,
        expectedDemoDataRevision: current.meta.demoDataRevision,
        idempotencyKey: crypto.randomUUID(),
      },
    ];
    const concurrentResponses = await Promise.all(
      concurrentMutations.map((mutation) =>
        request(`/api/v1/products/${currentProduct.productId}/price`, account.cookie, {
          method: "PATCH",
          headers: { origin: baseUrl, "content-type": "application/json" },
          body: JSON.stringify(mutation),
        }),
      ),
    );
    expect(concurrentResponses.map((response) => response.status).sort()).toEqual([200, 409]);
    const winnerIndex = concurrentResponses.findIndex((response) => response.status === 200);
    expect(winnerIndex).toBeGreaterThanOrEqual(0);
    const winner = priceMutationResponseSchema.parse(
      await concurrentResponses[winnerIndex]!.json(),
    );
    expect(winner.data.currentPrice).toBe(concurrentMutations[winnerIndex]!.price);
    expect(winner.data.version).toBe(currentProduct.version + 1);

    const after = productsResponseSchema.parse(
      await (await request("/api/v1/products?period=30d", account.cookie)).json(),
    );
    const afterProduct = after.data.products.find(
      (product) => product.productId === currentProduct.productId,
    );
    expect(afterProduct?.currentPrice).toBe(winner.data.currentPrice);
    expect(afterProduct?.version).toBe(winner.data.version);
  }, 60_000);
});
