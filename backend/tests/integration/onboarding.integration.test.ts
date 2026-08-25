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

    const repeat = await request("/api/v1/onboarding/complete", {
      method: "POST",
      body: payload,
      cookie,
    });
    expect(repeat.status).toBe(200);
    const repeatBody = onboardingCompleteResponseSchema.parse(await repeat.json());
    expect(repeatBody.data.profile.demoDataRevision).toBe(1);
    expect(repeatBody.data.counts).toEqual(firstBody.data.counts);

    const payloadConflict = await request("/api/v1/onboarding/complete", {
      method: "POST",
      body: { ...payload, networkName: "Another network" },
      cookie,
    });
    expect(payloadConflict.status).toBe(409);

    const current = await ownerClient.query<{ count: string; revision: number }>(
      `SELECT count(*)::text AS count, max(n.demo_data_revision)::int AS revision
       FROM app.products p JOIN app.networks n ON n.id = p.network_id
       WHERE p.network_id = $1`,
      [account.networkId],
    );
    expect(current.rows[0]?.count).toBe("12");
    expect(current.rows[0]?.revision).toBe(1);
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

  it("rolls back every phase when demo materialization fails and permits a retry", async () => {
    const account = await createE2eAccount(`stage4-rollback-${crypto.randomUUID().slice(0, 8)}`);
    const cookie = await login(account, "198.51.100.54");
    await request("/api/v1/onboarding/language", {
      method: "PUT",
      body: { language: "en", idempotencyKey: crypto.randomUUID() },
      cookie,
    });
    const payload = onboardingPayload(crypto.randomUUID());

    await expect(
      withRequestDatabase(runtimeUrl!, (db) =>
        db.transaction(async (transaction) => {
          await setTenantContext(transaction, account.networkId);
          return completeOnboarding(transaction, {
            authUserId: account.authUserId,
            networkId: account.networkId,
            request: payload,
            hooks: {
              afterPhase: (phase) => {
                if (phase === "products") throw new Error("injected stage4 failure");
              },
            },
          });
        }),
      ),
    ).rejects.toThrow("injected stage4 failure");

    const rolledBack = await ownerClient.query<{
      locations: string;
      products: string;
      revision: number;
    }>(
      `SELECT (SELECT count(*)::text FROM app.locations WHERE network_id = $1) AS locations,
              (SELECT count(*)::text FROM app.products WHERE network_id = $1) AS products,
              (SELECT demo_data_revision FROM app.networks WHERE id = $1) AS revision`,
      [account.networkId],
    );
    expect(rolledBack.rows[0]).toEqual({ locations: "0", products: "0", revision: 0 });

    const retry = await request("/api/v1/onboarding/complete", {
      method: "POST",
      body: payload,
      cookie,
    });
    expect(retry.status).toBe(200);
  });

  it("rolls back after every onboarding materialization phase", async () => {
    const phases = [
      "locations",
      "categories",
      "products",
      "orders",
      "inventory",
      "goal",
      "generation",
      "network",
      "completion-marker",
    ];

    for (const phase of phases) {
      const account = await createE2eAccount(
        `stage4-phase-${phase}-${crypto.randomUUID().slice(0, 6)}`,
      );
      const cookie = await login(account, `198.51.100.${60 + phases.indexOf(phase)}`);
      await request("/api/v1/onboarding/language", {
        method: "PUT",
        body: { language: "en", idempotencyKey: crypto.randomUUID() },
        cookie,
      });
      const payload = onboardingPayload(crypto.randomUUID());

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

      const rolledBack = await ownerClient.query<{
        locations: string;
        products: string;
        generations: string;
        completedAt: string | null;
        revision: number;
      }>(
        `SELECT (SELECT count(*)::text FROM app.locations WHERE network_id = $1) AS locations,
                (SELECT count(*)::text FROM app.products WHERE network_id = $1) AS products,
                (SELECT count(*)::text FROM app.demo_generations WHERE network_id = $1) AS generations,
                (SELECT onboarding_completed_at::text FROM app.networks WHERE id = $1) AS "completedAt",
                (SELECT demo_data_revision FROM app.networks WHERE id = $1) AS revision`,
        [account.networkId],
      );
      expect(rolledBack.rows[0]).toEqual({
        locations: "0",
        products: "0",
        generations: "0",
        completedAt: null,
        revision: 0,
      });

      const retry = await request("/api/v1/onboarding/complete", {
        method: "POST",
        body: payload,
        cookie,
      });
      expect(retry.status).toBe(200);
    }
  });

  it("rolls back an incomplete onboarding and preserves tenant data through Reset", async () => {
    const account = await createE2eAccount(`stage4-reset-${crypto.randomUUID().slice(0, 8)}`);
    const cookie = await login(account, "198.51.100.53");
    const withoutLanguage = await request("/api/v1/onboarding/complete", {
      method: "POST",
      body: onboardingPayload(crypto.randomUUID()),
      cookie,
    });
    expect(withoutLanguage.status).toBe(409);
    const empty = await ownerClient.query<{ locations: string; products: string }>(
      `SELECT (SELECT count(*)::text FROM app.locations WHERE network_id = $1) AS locations,
              (SELECT count(*)::text FROM app.products WHERE network_id = $1) AS products`,
      [account.networkId],
    );
    expect(empty.rows[0]).toEqual({ locations: "0", products: "0" });

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

    await ownerClient.query(
      `INSERT INTO app.feedback_responses
       (network_id, rating, comment, desired_features)
       VALUES ($1, 5, 'keep this', 'reset preservation')`,
      [account.networkId],
    );
    const before = await ownerClient.query<{ id: string; price: string }>(
      `SELECT id, current_price AS price FROM app.products
       WHERE network_id = $1 ORDER BY id LIMIT 1`,
      [account.networkId],
    );

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

    const after = await ownerClient.query<{ id: string; price: string; feedback: string }>(
      `SELECT p.id, p.current_price AS price,
              (SELECT comment FROM app.feedback_responses WHERE network_id = $1) AS feedback
       FROM app.products p WHERE p.network_id = $1 ORDER BY p.id LIMIT 1`,
      [account.networkId],
    );
    expect(after.rows[0]?.id).toBe(before.rows[0]?.id);
    expect(after.rows[0]?.price).toBe(before.rows[0]?.price);
    expect(after.rows[0]?.feedback).toBe("keep this");

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
    expect([concurrentFirst.generation.revision, concurrentSecond.generation.revision].sort()).toEqual(
      [3, 4],
    );

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
  });
});
