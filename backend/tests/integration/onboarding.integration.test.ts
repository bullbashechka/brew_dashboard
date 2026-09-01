import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  apiErrorResponseSchema,
  feedbackResponseSchema,
  onboardingCompleteResponseSchema,
  onboardingLanguageResponseSchema,
  productEventResponseSchema,
  revenueGoalMutationResponseSchema,
  resetResultResponseSchema,
  sessionResponseSchema,
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
const baseUrl = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:4173";
const secret = process.env.BETTER_AUTH_SECRET ?? "stage4-integration-secret-".padEnd(32, "x");
const integrationEnvironment = {
  HYPERDRIVE: { connectionString: runtimeUrl ?? "" } as Hyperdrive,
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: baseUrl,
  MFA_REQUIRED: "0",
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

  const completeAccount = async (loginPrefix: string, ip: string) => {
    const account = await createE2eAccount(`${loginPrefix}-${crypto.randomUUID().slice(0, 8)}`);
    const cookie = await login(account, ip);
    await request("/api/v1/onboarding/language", {
      method: "PUT",
      body: { language: "en", idempotencyKey: crypto.randomUUID() },
      cookie,
    });
    await request("/api/v1/onboarding/complete", {
      method: "POST",
      body: onboardingPayload(crypto.randomUUID()),
      cookie,
    });
    const session = await request("/api/v1/auth/me", { cookie });
    const profile = sessionResponseSchema.parse(await session.json()).data.profile;
    return { account, cookie, profile };
  };

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
                               FROM app.feedback_responses value WHERE value.network_id = $1), '[]'::jsonb)
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
  }, 60_000);

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
  }, 120_000);

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
  }, 120_000);

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
  }, 120_000);

  it("serves an authenticated idempotent demo reset endpoint", async () => {
    const account = await createE2eAccount(`stage8-reset-${crypto.randomUUID().slice(0, 8)}`);
    const cookie = await login(account, "198.51.100.58");
    await request("/api/v1/onboarding/language", {
      method: "PUT",
      body: { language: "en", idempotencyKey: crypto.randomUUID() },
      cookie,
    });
    await request("/api/v1/onboarding/complete", {
      method: "POST",
      body: onboardingPayload(crypto.randomUUID()),
      cookie,
    });

    const idempotencyKey = crypto.randomUUID();
    const first = await request("/api/v1/demo/reset", {
      method: "POST",
      body: { idempotencyKey },
      cookie,
    });
    expect(first.status).toBe(200);
    const firstBody = resetResultResponseSchema.parse(await first.json());
    expect(firstBody.data.profile.demoDataRevision).toBe(2);
    expect(firstBody.data.generation.revision).toBe(2);

    const replay = await request("/api/v1/demo/reset", {
      method: "POST",
      body: { idempotencyKey },
      cookie,
    });
    expect(replay.status).toBe(200);
    expect(resetResultResponseSchema.parse(await replay.json()).data.generation.revision).toBe(2);

    const guest = await request("/api/v1/demo/reset", {
      method: "POST",
      body: { idempotencyKey: crypto.randomUUID() },
    });
    expect(guest.status).toBe(401);
    expect(apiErrorResponseSchema.parse(await guest.json()).error.code).toBe("UNAUTHENTICATED");
  }, 120_000);

  it("persists Settings goal and feedback while accepting only strict product events", async () => {
    const account = await createE2eAccount(`stage11-settings-${crypto.randomUUID().slice(0, 8)}`);
    const cookie = await login(account, "198.51.100.61");
    await request("/api/v1/onboarding/language", {
      method: "PUT",
      body: { language: "en", idempotencyKey: crypto.randomUUID() },
      cookie,
    });
    await request("/api/v1/onboarding/complete", {
      method: "POST",
      body: onboardingPayload(crypto.randomUUID()),
      cookie,
    });
    const session = await request("/api/v1/auth/me", { cookie });
    const profile = sessionResponseSchema.parse(await session.json()).data.profile;

    const goal = await request("/api/v1/settings/revenue-goal", {
      method: "PUT",
      cookie,
      body: {
        monthlyGoal: "12345.00",
        expectedVersion: 1,
        expectedDemoDataRevision: profile.demoDataRevision,
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(goal.status).toBe(200);
    expect(revenueGoalMutationResponseSchema.parse(await goal.json()).data.monthlyGoal).toBe(
      "12345.00",
    );

    const emptyFeedback = await request("/api/v1/feedback", { cookie });
    expect(feedbackResponseSchema.parse(await emptyFeedback.json()).data).toBeNull();
    const feedback = await request("/api/v1/feedback", {
      method: "PUT",
      cookie,
      body: {
        rating: 4,
        comment: "Useful dashboard",
        desiredFeatures: "POS import",
        expectedVersion: null,
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(feedback.status).toBe(200);
    expect(feedbackResponseSchema.parse(await feedback.json()).data?.desiredFeatures).toBe(
      "POS import",
    );

    const eventId = crypto.randomUUID();
    const event = await request("/api/v1/events", {
      method: "POST",
      cookie,
      body: {
        eventId,
        type: "section_viewed",
        route: "settings",
        metadata: { section: "settings" },
      },
    });
    expect(productEventResponseSchema.parse(await event.json()).data.eventId).toBe(eventId);
    const replay = await request("/api/v1/events", {
      method: "POST",
      cookie,
      body: {
        eventId,
        type: "section_viewed",
        route: "settings",
        metadata: { section: "settings" },
      },
    });
    expect(replay.status).toBe(200);
    const rejected = await request("/api/v1/events", {
      method: "POST",
      cookie,
      body: {
        eventId: crypto.randomUUID(),
        type: "section_viewed",
        metadata: { section: "settings", comment: "must not persist" },
      },
    });
    expect(rejected.status).toBe(400);

    const reset = await request("/api/v1/demo/reset", {
      method: "POST",
      cookie,
      body: { idempotencyKey: crypto.randomUUID() },
    });
    expect(reset.status).toBe(200);
    const afterReset = await request("/api/v1/feedback", { cookie });
    expect(feedbackResponseSchema.parse(await afterReset.json()).data?.comment).toBe(
      "Useful dashboard",
    );
    const events = await ownerClient.query<{ type: string; count: number }>(
      `SELECT type::text AS type, count(*)::int AS count
       FROM app.product_events
       WHERE network_id = $1 AND type IN ('feedback_submitted', 'demo_reset')
       GROUP BY type`,
      [account.networkId],
    );
    expect(events.rows.sort((left, right) => left.type.localeCompare(right.type))).toEqual([
      { type: "demo_reset", count: 1 },
      { type: "feedback_submitted", count: 1 },
    ]);
  }, 120_000);

  it("persists Settings language idempotently and isolates tenants", async () => {
    const account = await createE2eAccount(
      `stage11-settings-language-${crypto.randomUUID().slice(0, 8)}`,
    );
    const otherAccount = await createE2eAccount(
      `stage11-settings-language-other-${crypto.randomUUID().slice(0, 8)}`,
    );
    const cookie = await login(account, "198.51.100.64");
    await request("/api/v1/onboarding/language", {
      method: "PUT",
      body: { language: "en", idempotencyKey: crypto.randomUUID() },
      cookie,
    });
    await request("/api/v1/onboarding/complete", {
      method: "POST",
      body: onboardingPayload(crypto.randomUUID()),
      cookie,
    });

    const idempotencyKey = crypto.randomUUID();
    const language = await request("/api/v1/settings/language", {
      method: "PUT",
      cookie,
      body: { language: "ru", idempotencyKey },
    });
    expect(language.status).toBe(200);
    expect(onboardingLanguageResponseSchema.parse(await language.json()).data).toEqual({
      language: "ru",
      effectiveLanguage: "ru",
    });

    const replay = await request("/api/v1/settings/language", {
      method: "PUT",
      cookie,
      body: { language: "ru", idempotencyKey },
    });
    expect(replay.status).toBe(200);
    expect(onboardingLanguageResponseSchema.parse(await replay.json()).data).toEqual({
      language: "ru",
      effectiveLanguage: "ru",
    });

    const conflict = await request("/api/v1/settings/language", {
      method: "PUT",
      cookie,
      body: { language: "en", idempotencyKey },
    });
    expect(conflict.status).toBe(409);
    expect(apiErrorResponseSchema.parse(await conflict.json()).error.code).toBe("CONFLICT");

    const invalid = await request("/api/v1/settings/language", {
      method: "PUT",
      cookie,
      body: { language: "de", idempotencyKey: crypto.randomUUID() },
    });
    expect(invalid.status).toBe(400);
    expect(apiErrorResponseSchema.parse(await invalid.json()).error.code).toBe("VALIDATION_ERROR");

    const session = sessionResponseSchema.parse(
      await (await request("/api/v1/auth/me", { cookie })).json(),
    );
    expect(session.data.profile.language).toBe("ru");
    expect(session.data.profile.effectiveLanguage).toBe("ru");

    const tenantLanguages = await ownerClient.query<{ id: string; language: string | null }>(
      `SELECT id::text AS id, language
       FROM app.networks
       WHERE id IN ($1, $2)
       ORDER BY id`,
      [account.networkId, otherAccount.networkId],
    );
    expect(tenantLanguages.rows.find((row) => row.id === account.networkId)?.language).toBe("ru");
    expect(
      tenantLanguages.rows.find((row) => row.id === otherAccount.networkId)?.language,
    ).toBeNull();
  }, 120_000);

  it("keeps server events private and rate-limits client telemetry", async () => {
    const first = await completeAccount("stage11-event-limit", "198.51.100.62");
    const serverOnlyEvents = [
      { type: "login_succeeded", metadata: {} },
      { type: "onboarding_completed", metadata: { locationCount: 3 } },
      { type: "product_price_changed", metadata: { productId: crypto.randomUUID() } },
      {
        type: "inventory_movement_created",
        metadata: {
          inventoryItemId: crypto.randomUUID(),
          locationId: crypto.randomUUID(),
          type: "receipt",
        },
      },
      { type: "revenue_goal_changed", metadata: {} },
      { type: "demo_reset", metadata: { generatorVersion: "v1" } },
      { type: "feedback_submitted", metadata: { rating: 5 } },
    ] as const;
    for (const event of serverOnlyEvents) {
      const response = await request("/api/v1/events", {
        method: "POST",
        cookie: first.cookie,
        body: { eventId: crypto.randomUUID(), ...event },
      });
      expect(response.status).toBe(400);
      expect(apiErrorResponseSchema.parse(await response.json()).error.code).toBe(
        "VALIDATION_ERROR",
      );
    }

    for (let index = 0; index < 30; index += 1) {
      const response = await request("/api/v1/events", {
        method: "POST",
        cookie: first.cookie,
        body: {
          eventId: crypto.randomUUID(),
          type: "section_viewed",
          route: "overview",
          metadata: { section: "overview" },
        },
      });
      expect(response.status).toBe(200);
    }
    const burstLimited = await request("/api/v1/events", {
      method: "POST",
      cookie: first.cookie,
      body: {
        eventId: crypto.randomUUID(),
        type: "filter_changed",
        route: "overview",
        metadata: { filter: "period", period: "today", locationId: null },
      },
    });
    expect(burstLimited.status).toBe(429);
    expect(apiErrorResponseSchema.parse(await burstLimited.json()).error.code).toBe("RATE_LIMITED");
    expect(Number(burstLimited.headers.get("retry-after"))).toBeGreaterThan(0);

    const serverMutationAfterBurst = await request("/api/v1/feedback", {
      method: "PUT",
      cookie: first.cookie,
      body: {
        rating: 5,
        desiredFeatures: "Server events still work",
        expectedVersion: null,
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(serverMutationAfterBurst.status).toBe(200);

    const second = await completeAccount("stage11-event-daily", "198.51.100.63");
    const dailyKey = `product-events:daily:${second.account.networkId}`;
    await ownerClient.query(
      `INSERT INTO auth.rate_limits (id, key, count, last_request)
       VALUES ($1, $2, 300, $3)
       ON CONFLICT (key) DO UPDATE SET count = EXCLUDED.count, last_request = EXCLUDED.last_request`,
      [crypto.randomUUID(), dailyKey, Date.now()],
    );
    const dailyLimited = await request("/api/v1/events", {
      method: "POST",
      cookie: second.cookie,
      body: {
        eventId: crypto.randomUUID(),
        type: "section_viewed",
        route: "settings",
        metadata: { section: "settings" },
      },
    });
    expect(dailyLimited.status).toBe(429);
    expect(apiErrorResponseSchema.parse(await dailyLimited.json()).error.code).toBe("RATE_LIMITED");
    expect(Number(dailyLimited.headers.get("retry-after"))).toBeGreaterThan(0);
    const serverMutationAfterDaily = await request("/api/v1/feedback", {
      method: "PUT",
      cookie: second.cookie,
      body: {
        rating: 4,
        desiredFeatures: "Server events bypass client quota",
        expectedVersion: null,
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(serverMutationAfterDaily.status).toBe(200);
  }, 60_000);
});
