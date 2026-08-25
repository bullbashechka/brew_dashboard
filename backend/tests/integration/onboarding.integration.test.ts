import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  apiErrorResponseSchema,
  onboardingCompleteResponseSchema,
  onboardingLanguageResponseSchema,
} from "@brew-dashboard/contracts";
import { sql } from "drizzle-orm";
import { Client } from "pg";

import { createAccount, deleteAccount } from "../../src/admin/accounts.ts";
import { SESSION_COOKIE_NAME } from "../../src/auth/better-auth.ts";
import { __test as authHttpTest } from "../../src/auth/http.ts";
import { setTenantContext, withRequestDatabase } from "../../src/db/client.ts";
import { completeOnboarding, resetDemoData } from "../../src/onboarding/service.ts";
import { app } from "../../src/index.ts";

const ownerUrl = process.env.DATABASE_TEST_URL;
const runtimeUrl = process.env.DATABASE_TEST_RUNTIME_URL;
const baseUrl = process.env.BETTER_AUTH_URL ?? "https://brew-dashboard.test";
const secret = process.env.BETTER_AUTH_SECRET ?? "stage4-integration-secret-".padEnd(32, "x");
const integrationEnvironment = {
  HYPERDRIVE: { connectionString: runtimeUrl ?? "" } as Hyperdrive,
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: baseUrl,
};

type TestAccount = Awaited<ReturnType<typeof createAccount>>;
const describeIntegration = describe.skipIf(!ownerUrl || !runtimeUrl);

describeIntegration("Stage 4 onboarding and deterministic demo data", () => {
  const ownerClient = new Client({ connectionString: ownerUrl });
  const createdAccounts: TestAccount[] = [];

  const createE2eAccount = async (login: string) => {
    const account = await withRequestDatabase(ownerUrl!, (db) =>
      createAccount(db, { login, password: "Stage4-account-A1", accountKind: "e2e" }),
    );
    createdAccounts.push(account);
    return account;
  };

  const request = async (
    path: string,
    options: {
      method?: "GET" | "PUT" | "POST";
      body?: unknown;
      cookie?: string;
      ip?: string;
    } = {},
  ) => {
    const headers = new Headers();
    if (options.cookie) headers.set("cookie", options.cookie);
    if (options.ip) headers.set("cf-connecting-ip", options.ip);
    if (options.method === "PUT" || options.method === "POST") {
      headers.set("origin", baseUrl);
      headers.set("content-type", "application/json");
    }
    const init: RequestInit = { method: options.method ?? "GET", headers };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    return app.request(new URL(path, baseUrl), init, integrationEnvironment);
  };

  const cookieFrom = (response: Response) =>
    authHttpTest
      .getSetCookieValues(response.headers)
      .find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`))
      ?.split(";", 1)[0];

  const login = async (account: TestAccount, ip: string) => {
    const response = await request("/api/v1/auth/login", {
      method: "POST",
      body: { login: account.login, password: account.password },
      ip,
    });
    const cookie = cookieFrom(response);
    if (!cookie) throw new Error("Expected a session cookie");
    return cookie;
  };

  const onboardingPayload = (idempotencyKey: string) => ({
    networkName: "  Stage   Four  ",
    ownerName: " Demo Owner ",
    locations: [{ name: " Central " }, { name: "Airport" }, { name: "Riverside" }],
    country: "KZ",
    currency: "KZT",
    timeZone: "Asia/Almaty",
    idempotencyKey,
  });

  type TenantDataSnapshot = {
    locations: unknown[];
    categories: unknown[];
    products: unknown[];
    orders: unknown[];
    orderItems: unknown[];
    inventoryItems: unknown[];
    inventoryBalances: unknown[];
    inventoryMovements: unknown[];
    revenueTargets: unknown[];
    demoGenerations: unknown[];
  };

  const readTenantDataSnapshot = async (networkId: string): Promise<TenantDataSnapshot> => {
    const result = await ownerClient.query<TenantDataSnapshot>(
      `SELECT
         COALESCE((SELECT jsonb_agg(to_jsonb(value) - 'network_id' ORDER BY value.id)
                   FROM app.locations value WHERE value.network_id = $1), '[]'::jsonb) AS locations,
         COALESCE((SELECT jsonb_agg(to_jsonb(value) - 'network_id' ORDER BY value.id)
                   FROM app.categories value WHERE value.network_id = $1), '[]'::jsonb) AS categories,
         COALESCE((SELECT jsonb_agg(to_jsonb(value) - 'network_id' ORDER BY value.id)
                   FROM app.products value WHERE value.network_id = $1), '[]'::jsonb) AS products,
         COALESCE((SELECT jsonb_agg(to_jsonb(value) - 'network_id' ORDER BY value.id)
                   FROM app.orders value WHERE value.network_id = $1), '[]'::jsonb) AS orders,
         COALESCE((SELECT jsonb_agg(to_jsonb(value) - 'network_id' ORDER BY value.id)
                   FROM app.order_items value WHERE value.network_id = $1), '[]'::jsonb) AS "orderItems",
         COALESCE((SELECT jsonb_agg(to_jsonb(value) - 'network_id' ORDER BY value.id)
                   FROM app.inventory_items value WHERE value.network_id = $1), '[]'::jsonb) AS "inventoryItems",
         COALESCE((SELECT jsonb_agg(to_jsonb(value) - 'network_id' ORDER BY value.id)
                   FROM app.inventory_balances value WHERE value.network_id = $1), '[]'::jsonb) AS "inventoryBalances",
         COALESCE((SELECT jsonb_agg(to_jsonb(value) - 'network_id' ORDER BY value.id)
                   FROM app.inventory_movements value WHERE value.network_id = $1), '[]'::jsonb) AS "inventoryMovements",
         COALESCE((SELECT jsonb_agg(to_jsonb(value) - 'network_id' ORDER BY value.id)
                   FROM app.revenue_targets value WHERE value.network_id = $1), '[]'::jsonb) AS "revenueTargets",
         COALESCE((SELECT jsonb_agg(to_jsonb(value) - 'network_id'
                                           ORDER BY value.generated_for_date, value.id)
                   FROM app.demo_generations value WHERE value.network_id = $1), '[]'::jsonb) AS "demoGenerations"`,
      [networkId],
    );
    return result.rows[0]!;
  };

  const readNetworkGenerationState = async (networkId: string) => {
    const result = await ownerClient.query<{
      name: string | null;
      ownerName: string | null;
      countryCode: string | null;
      currencyCode: string | null;
      timeZone: string | null;
      completedAt: string | null;
      generatedForDate: string | null;
      generatorVersion: string | null;
      revision: number;
    }>(
      `SELECT name,
              owner_name AS "ownerName",
              country_code AS "countryCode",
              currency_code AS "currencyCode",
              timezone AS "timeZone",
              onboarding_completed_at::text AS "completedAt",
              demo_generated_for_date::text AS "generatedForDate",
              demo_generator_version AS "generatorVersion",
              demo_data_revision AS revision
       FROM app.networks WHERE id = $1`,
      [networkId],
    );
    return result.rows[0]!;
  };

  const readPreservedSnapshot = async (networkId: string) => {
    const result = await ownerClient.query<{ snapshot: unknown }>(
      `SELECT jsonb_build_object(
         'network', jsonb_build_object(
           'name', network.name,
           'ownerName', network.owner_name,
           'countryCode', network.country_code,
           'currencyCode', network.currency_code,
           'timeZone', network.timezone,
           'language', network.language
         ),
         'account', (SELECT to_jsonb(value) - 'id' - 'auth_user_id' - 'network_id' -
                                    'last_login_at' - 'created_at' - 'updated_at'
                     FROM app.app_users value WHERE value.network_id = $1),
         'locations', COALESCE((SELECT jsonb_agg(to_jsonb(value) - 'network_id'
                                                       ORDER BY value.sort_order, value.id)
                                FROM app.locations value WHERE value.network_id = $1), '[]'::jsonb),
         'feedback', COALESCE((SELECT jsonb_agg(to_jsonb(value) - 'network_id' ORDER BY value.id)
                               FROM app.feedback_responses value WHERE value.network_id = $1), '[]'::jsonb),
         'events', COALESCE((SELECT jsonb_agg(to_jsonb(value) - 'network_id' ORDER BY value.id)
                             FROM app.product_events value WHERE value.network_id = $1), '[]'::jsonb)
       ) AS snapshot
       FROM app.networks network WHERE network.id = $1`,
      [networkId],
    );
    return result.rows[0]!.snapshot;
  };

  const expectNoMaterializedData = (snapshot: TenantDataSnapshot) => {
    for (const rows of Object.values(snapshot)) expect(rows).toEqual([]);
  };

  beforeAll(async () => {
    await ownerClient.connect();
  });

  afterAll(async () => {
    for (const account of createdAccounts) {
      await withRequestDatabase(ownerUrl!, async (db) => {
        try {
          await deleteAccount(db, { login: account.login, accountKind: "e2e" });
        } catch {
          // The test cleanup must remain best-effort if a prior assertion failed.
        }
      });
    }
    await ownerClient.end();
  });

  it("requires language, blocks business access, and completes onboarding idempotently", async () => {
    const account = await createE2eAccount(`stage4-onboarding-${crypto.randomUUID().slice(0, 8)}`);
    const cookie = await login(account, "198.51.100.51");

    const blocked = await request("/api/v1/overview", { cookie });
    expect(blocked.status).toBe(403);
    expect(apiErrorResponseSchema.parse(await blocked.json()).error.code).toBe("FORBIDDEN");

    const languageKey = crypto.randomUUID();
    const language = await request("/api/v1/onboarding/language", {
      method: "PUT",
      body: { language: "en", idempotencyKey: languageKey },
      cookie,
    });
    expect(language.status).toBe(200);
    expect(onboardingLanguageResponseSchema.parse(await language.json()).data.language).toBe("en");

    const operationConflict = await request("/api/v1/onboarding/complete", {
      method: "POST",
      body: { ...onboardingPayload(languageKey), idempotencyKey: languageKey },
      cookie,
    });
    expect(operationConflict.status).toBe(409);

    const payload = onboardingPayload(crypto.randomUUID());
    const first = await request("/api/v1/onboarding/complete", {
      method: "POST",
      body: payload,
      cookie,
    });
    expect(first.status).toBe(200);
    const firstBody = onboardingCompleteResponseSchema.parse(await first.json());
    expect(firstBody.data.profile.networkName).toBe("Stage Four");
    expect(firstBody.data.profile.demoDataRevision).toBe(1);
    expect(firstBody.data.counts.products).toBe(12);
    expect(firstBody.data.counts.inventoryBalances).toBe(36);
    const firstSnapshot = await readTenantDataSnapshot(account.networkId);

    const repeat = await request("/api/v1/onboarding/complete", {
      method: "POST",
      body: payload,
      cookie,
    });
    expect(repeat.status).toBe(200);
    const repeatBody = onboardingCompleteResponseSchema.parse(await repeat.json());
    expect(repeatBody.data.profile.demoDataRevision).toBe(1);
    expect(repeatBody.data.counts).toEqual(firstBody.data.counts);
    expect(await readTenantDataSnapshot(account.networkId)).toEqual(firstSnapshot);

    const completedReplay = await request("/api/v1/onboarding/complete", {
      method: "POST",
      body: { ...payload, idempotencyKey: crypto.randomUUID() },
      cookie,
    });
    expect(completedReplay.status).toBe(200);
    expect(
      onboardingCompleteResponseSchema.parse(await completedReplay.json()).data.counts,
    ).toEqual(firstBody.data.counts);
    expect(await readTenantDataSnapshot(account.networkId)).toEqual(firstSnapshot);

    const payloadConflict = await request("/api/v1/onboarding/complete", {
      method: "POST",
      body: { ...payload, networkName: "Another network" },
      cookie,
    });
    expect(payloadConflict.status).toBe(409);

    expect(await readNetworkGenerationState(account.networkId)).toMatchObject({
      completedAt: expect.any(String),
      generatedForDate: expect.any(String),
      generatorVersion: "v1",
      revision: 1,
    });
  });

  it("lets the first concurrent onboarding win and returns its state to the other tab", async () => {
    const account = await createE2eAccount(`stage4-race-${crypto.randomUUID().slice(0, 8)}`);
    const cookie = await login(account, "198.51.100.52");
    await request("/api/v1/onboarding/language", {
      method: "PUT",
      body: { language: "ru", idempotencyKey: crypto.randomUUID() },
      cookie,
    });

    const firstPayload = onboardingPayload(crypto.randomUUID());
    const secondPayload = onboardingPayload(crypto.randomUUID());
    const [first, second] = await Promise.all([
      request("/api/v1/onboarding/complete", { method: "POST", body: firstPayload, cookie }),
      request("/api/v1/onboarding/complete", { method: "POST", body: secondPayload, cookie }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 200]);
    const firstBody = onboardingCompleteResponseSchema.parse(await first.json());
    const secondBody = onboardingCompleteResponseSchema.parse(await second.json());
    expect(firstBody.data.profile.networkName).toBe(secondBody.data.profile.networkName);
    expect(firstBody.data.profile.demoDataRevision).toBe(1);
  });

  it("rolls back after every onboarding materialization phase", async () => {
    const phases = [
      "locations",
      "generated",
      "categories",
      "products",
      "orders",
      "inventory",
      "goal",
      "generation",
      "network",
      "completion-marker",
    ];
    const account = await createE2eAccount(`stage4-phases-${crypto.randomUUID().slice(0, 8)}`);
    const cookie = await login(account, "198.51.100.54");
    await request("/api/v1/onboarding/language", {
      method: "PUT",
      body: { language: "en", idempotencyKey: crypto.randomUUID() },
      cookie,
    });
    const payload = onboardingPayload(crypto.randomUUID());

    for (const phase of phases) {
      await expect(
        withRequestDatabase(runtimeUrl!, (db) =>
          db.transaction(async (transaction) => {
            await setTenantContext(transaction, account.networkId);
            return completeOnboarding(transaction, {
              authUserId: account.authUserId,
              networkId: account.networkId,
              request: payload,
              hooks: {
                afterPhase: (currentPhase) => {
                  if (currentPhase === phase) throw new Error(`injected ${phase} failure`);
                },
              },
            });
          }),
        ),
      ).rejects.toThrow(`injected ${phase} failure`);

      expectNoMaterializedData(await readTenantDataSnapshot(account.networkId));
      expect(await readNetworkGenerationState(account.networkId)).toEqual({
        name: null,
        ownerName: null,
        countryCode: null,
        currencyCode: null,
        timeZone: null,
        completedAt: null,
        generatedForDate: null,
        generatorVersion: null,
        revision: 0,
      });
    }

    const retry = await request("/api/v1/onboarding/complete", {
      method: "POST",
      body: payload,
      cookie,
    });
    expect(retry.status).toBe(200);
  }, 30_000);

  it("rolls back every Reset phase to the previous complete dataset", async () => {
    const account = await createE2eAccount(
      `stage4-reset-phases-${crypto.randomUUID().slice(0, 8)}`,
    );
    const cookie = await login(account, "198.51.100.55");
    await request("/api/v1/onboarding/language", {
      method: "PUT",
      body: { language: "en", idempotencyKey: crypto.randomUUID() },
      cookie,
    });
    const complete = await request("/api/v1/onboarding/complete", {
      method: "POST",
      body: onboardingPayload(crypto.randomUUID()),
      cookie,
    });
    expect(complete.status).toBe(200);

    const beforeData = await readTenantDataSnapshot(account.networkId);
    const beforeNetwork = await readNetworkGenerationState(account.networkId);
    const phases = [
      "generated",
      "cleared",
      "categories",
      "products",
      "orders",
      "inventory",
      "goal",
      "generation",
      "network",
    ];

    for (const phase of phases) {
      await expect(
        withRequestDatabase(runtimeUrl!, (db) =>
          db.transaction(async (transaction) => {
            await setTenantContext(transaction, account.networkId);
            return resetDemoData(transaction, {
              authUserId: account.authUserId,
              networkId: account.networkId,
              idempotencyKey: crypto.randomUUID(),
              hooks: {
                afterPhase: (currentPhase) => {
                  if (currentPhase === phase) throw new Error(`injected reset ${phase} failure`);
                },
              },
            });
          }),
        ),
      ).rejects.toThrow(`injected reset ${phase} failure`);

      expect(await readTenantDataSnapshot(account.networkId)).toEqual(beforeData);
      expect(await readNetworkGenerationState(account.networkId)).toEqual(beforeNetwork);
    }

    const retry = await withRequestDatabase(runtimeUrl!, (db) =>
      db.transaction(async (transaction) => {
        await setTenantContext(transaction, account.networkId);
        return resetDemoData(transaction, {
          authUserId: account.authUserId,
          networkId: account.networkId,
          idempotencyKey: crypto.randomUUID(),
        });
      }),
    );
    expect(retry.generation.revision).toBe(2);
  }, 30_000);

  it("regenerates deterministically while preserving preferences and tenant isolation", async () => {
    const account = await createE2eAccount(`stage4-reset-${crypto.randomUUID().slice(0, 8)}`);
    const otherAccount = await createE2eAccount(
      `stage4-reset-other-${crypto.randomUUID().slice(0, 8)}`,
    );
    const cookie = await login(account, "198.51.100.53");
    const otherCookie = await login(otherAccount, "198.51.100.56");
    const withoutLanguage = await request("/api/v1/onboarding/complete", {
      method: "POST",
      body: onboardingPayload(crypto.randomUUID()),
      cookie,
    });
    expect(withoutLanguage.status).toBe(409);
    expectNoMaterializedData(await readTenantDataSnapshot(account.networkId));

    await request("/api/v1/onboarding/language", {
      method: "PUT",
      body: { language: "en", idempotencyKey: crypto.randomUUID() },
      cookie,
    });
    const complete = await request("/api/v1/onboarding/complete", {
      method: "POST",
      body: onboardingPayload(crypto.randomUUID()),
      cookie,
    });
    expect(complete.status).toBe(200);
    await request("/api/v1/onboarding/language", {
      method: "PUT",
      body: { language: "ru", idempotencyKey: crypto.randomUUID() },
      cookie: otherCookie,
    });
    const otherComplete = await request("/api/v1/onboarding/complete", {
      method: "POST",
      body: {
        ...onboardingPayload(crypto.randomUUID()),
        networkName: "Other tenant",
        ownerName: "Other Owner",
      },
      cookie: otherCookie,
    });
    expect(otherComplete.status).toBe(200);

    await ownerClient.query(
      `UPDATE app.app_users SET tour_completed_at = '2026-08-25T05:00:00.000Z'
       WHERE network_id = $1`,
      [account.networkId],
    );
    await ownerClient.query(
      `INSERT INTO app.feedback_responses
       (network_id, rating, comment, desired_features)
       VALUES ($1, 5, 'keep this', 'reset preservation')`,
      [account.networkId],
    );
    const beforeData = await readTenantDataSnapshot(account.networkId);
    const beforePreserved = await readPreservedSnapshot(account.networkId);
    const otherBefore = {
      data: await readTenantDataSnapshot(otherAccount.networkId),
      network: await readNetworkGenerationState(otherAccount.networkId),
      preserved: await readPreservedSnapshot(otherAccount.networkId),
    };

    const resetKey = crypto.randomUUID();
    const reset = await withRequestDatabase(runtimeUrl!, (db) =>
      db.transaction(async (transaction) => {
        await setTenantContext(transaction, account.networkId);
        return resetDemoData(transaction, {
          authUserId: account.authUserId,
          networkId: account.networkId,
          idempotencyKey: resetKey,
        });
      }),
    );
    expect(reset.generation.revision).toBe(2);
    expect(await readTenantDataSnapshot(account.networkId)).toEqual(beforeData);
    expect(await readPreservedSnapshot(account.networkId)).toEqual(beforePreserved);
    expect({
      data: await readTenantDataSnapshot(otherAccount.networkId),
      network: await readNetworkGenerationState(otherAccount.networkId),
      preserved: await readPreservedSnapshot(otherAccount.networkId),
    }).toEqual(otherBefore);

    const latestOrder = await ownerClient.query<{ orderedAt: Date | null; count: number }>(
      `SELECT max(ordered_at) AS "orderedAt", count(*)::int AS count
       FROM app.orders WHERE network_id = $1`,
      [account.networkId],
    );
    expect(latestOrder.rows[0]!.orderedAt!.getTime()).toBeLessThanOrEqual(
      new Date(reset.generation.anchor).getTime(),
    );
    const health = await request("/api/v1/health");
    const currentSession = await request("/api/v1/auth/me", { cookie });
    expect(health.status).toBe(200);
    expect(currentSession.status).toBe(200);
    expect(await readTenantDataSnapshot(account.networkId)).toEqual(beforeData);

    const resetRepeat = await withRequestDatabase(runtimeUrl!, (db) =>
      db.transaction(async (transaction) => {
        await setTenantContext(transaction, account.networkId);
        return resetDemoData(transaction, {
          authUserId: account.authUserId,
          networkId: account.networkId,
          idempotencyKey: resetKey,
        });
      }),
    );
    expect(resetRepeat.generation.revision).toBe(2);
    expect(await readTenantDataSnapshot(account.networkId)).toEqual(beforeData);

    await expect(
      withRequestDatabase(runtimeUrl!, (db) =>
        db.transaction(async (transaction) => {
          await setTenantContext(transaction, otherAccount.networkId);
          return resetDemoData(transaction, {
            authUserId: account.authUserId,
            networkId: otherAccount.networkId,
            idempotencyKey: crypto.randomUUID(),
          });
        }),
      ),
    ).rejects.toThrow("does not own this network");
    expect({
      data: await readTenantDataSnapshot(otherAccount.networkId),
      network: await readNetworkGenerationState(otherAccount.networkId),
      preserved: await readPreservedSnapshot(otherAccount.networkId),
    }).toEqual(otherBefore);

    const [concurrentFirst, concurrentSecond] = await Promise.all([
      withRequestDatabase(runtimeUrl!, (db) =>
        db.transaction(async (transaction) => {
          await setTenantContext(transaction, account.networkId);
          return resetDemoData(transaction, {
            authUserId: account.authUserId,
            networkId: account.networkId,
            idempotencyKey: crypto.randomUUID(),
          });
        }),
      ),
      withRequestDatabase(runtimeUrl!, (db) =>
        db.transaction(async (transaction) => {
          await setTenantContext(transaction, account.networkId);
          return resetDemoData(transaction, {
            authUserId: account.authUserId,
            networkId: account.networkId,
            idempotencyKey: crypto.randomUUID(),
          });
        }),
      ),
    ]);
    expect(
      [concurrentFirst.generation.revision, concurrentSecond.generation.revision].sort(),
    ).toEqual([3, 4]);
    expect(await readTenantDataSnapshot(account.networkId)).toEqual(beforeData);
    expect(await readPreservedSnapshot(account.networkId)).toEqual(beforePreserved);

    await expect(
      withRequestDatabase(runtimeUrl!, (db) =>
        db.transaction(async (transaction) => {
          await setTenantContext(transaction, account.networkId);
          await transaction.execute(sql`delete from app.inventory_balances`);
        }),
      ),
    ).rejects.toBeDefined();
    await expect(
      withRequestDatabase(runtimeUrl!, (db) =>
        db.transaction(async (transaction) => {
          await setTenantContext(transaction, account.networkId);
          await transaction.execute(sql`select app.replace_inventory_baseline('[]'::jsonb, now())`);
        }),
      ),
    ).rejects.toBeDefined();
  }, 30_000);
});
