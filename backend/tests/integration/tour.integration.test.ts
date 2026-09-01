import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  apiErrorResponseSchema,
  sessionResponseSchema,
  tourStateResponseSchema,
} from "@brew-dashboard/contracts";
import { Client } from "pg";

import { createAccount, deleteAccount } from "../../src/admin/accounts.ts";
import { SESSION_COOKIE_NAME } from "../../src/auth/better-auth.ts";
import { __test as authHttpTest } from "../../src/auth/http.ts";
import { withRequestDatabase } from "../../src/db/client.ts";
import { app } from "../../src/index.ts";

const ownerUrl = process.env.DATABASE_TEST_URL;
const runtimeUrl = process.env.DATABASE_TEST_RUNTIME_URL;
const baseUrl = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:4173";
const secret = process.env.BETTER_AUTH_SECRET ?? "stage7-integration-secret-".padEnd(32, "x");
const environment = {
  HYPERDRIVE: { connectionString: runtimeUrl ?? "" } as Hyperdrive,
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: baseUrl,
  MFA_REQUIRED: "0",
};

type TestAccount = Awaited<ReturnType<typeof createAccount>>;
const describeIntegration = describe.skipIf(!ownerUrl || !runtimeUrl);

describeIntegration("Stage 7 guided tour API", () => {
  const ownerClient = new Client({ connectionString: ownerUrl });
  const accounts: TestAccount[] = [];

  const request = async (
    path: string,
    options: { method?: "GET" | "POST" | "PUT"; body?: unknown; cookie?: string } = {},
  ) => {
    const headers = new Headers();
    if (options.cookie) headers.set("cookie", options.cookie);
    if (options.method === "POST" || options.method === "PUT") {
      headers.set("origin", baseUrl);
      headers.set("content-type", "application/json");
    }
    return app.request(
      new URL(path, baseUrl),
      {
        method: options.method ?? "GET",
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      },
      environment,
    );
  };

  const createE2eAccount = async () => {
    const account = await withRequestDatabase(ownerUrl!, (db) =>
      createAccount(db, {
        login: `stage7-tour-${crypto.randomUUID().slice(0, 8)}`,
        password: "Stage7-account-A1",
        accountKind: "e2e",
      }),
    );
    accounts.push(account);
    return account;
  };

  const login = async (account: TestAccount) => {
    const response = await request("/api/v1/auth/login", {
      method: "POST",
      body: { login: account.login, password: account.password },
    });
    const cookie = authHttpTest
      .getSetCookieValues(response.headers)
      .find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`))
      ?.split(";", 1)[0];
    if (!cookie) throw new Error("Expected session cookie");
    return cookie;
  };

  const completeOnboarding = async (cookie: string) => {
    await request("/api/v1/onboarding/language", {
      method: "PUT",
      cookie,
      body: { language: "en", idempotencyKey: crypto.randomUUID() },
    });
    const response = await request("/api/v1/onboarding/complete", {
      method: "POST",
      cookie,
      body: {
        networkName: "Tour Network",
        ownerName: "Tour Owner",
        locations: [{ name: "Central" }],
        country: "KZ",
        currency: "KZT",
        timeZone: "Asia/Almaty",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(response.status).toBe(200);
  };

  beforeAll(async () => {
    await ownerClient.connect();
  });

  afterAll(async () => {
    for (const account of accounts) {
      await withRequestDatabase(ownerUrl!, async (db) => {
        try {
          await deleteAccount(db, { login: account.login, accountKind: "e2e" });
        } catch {
          // Cleanup must remain best-effort if an assertion has failed.
        }
      });
    }
    await ownerClient.end();
  });

  it("requires completed onboarding and persists skipped, completed, and restarted tour state", async () => {
    const account = await createE2eAccount();
    const cookie = await login(account);
    const guest = await request("/api/v1/settings/tour", {
      method: "PUT",
      body: { state: "skipped", idempotencyKey: crypto.randomUUID() },
    });
    expect(guest.status).toBe(401);
    expect(apiErrorResponseSchema.parse(await guest.json()).error.code).toBe("UNAUTHENTICATED");

    const incomplete = await request("/api/v1/settings/tour", {
      method: "PUT",
      cookie,
      body: { state: "skipped", idempotencyKey: crypto.randomUUID() },
    });
    expect(incomplete.status).toBe(403);

    await completeOnboarding(cookie);
    const key = crypto.randomUUID();
    const skipped = await request("/api/v1/settings/tour", {
      method: "PUT",
      cookie,
      body: { state: "skipped", idempotencyKey: key },
    });
    expect(tourStateResponseSchema.parse(await skipped.json()).data.state).toBe("skipped");

    const replay = await request("/api/v1/settings/tour", {
      method: "PUT",
      cookie,
      body: { state: "skipped", idempotencyKey: key },
    });
    expect(replay.status).toBe(200);

    const conflict = await request("/api/v1/settings/tour", {
      method: "PUT",
      cookie,
      body: { state: "completed", idempotencyKey: key },
    });
    expect(conflict.status).toBe(409);

    for (const state of ["completed", "pending"] as const) {
      const response = await request("/api/v1/settings/tour", {
        method: "PUT",
        cookie,
        body: { state, idempotencyKey: crypto.randomUUID() },
      });
      expect(tourStateResponseSchema.parse(await response.json()).data.state).toBe(state);
    }

    const profile = await request("/api/v1/auth/me", { cookie });
    expect(sessionResponseSchema.parse(await profile.json()).data.profile.tourState).toBe(
      "pending",
    );
  });
});
