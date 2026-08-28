import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  apiErrorResponseSchema,
  logoutResponseSchema,
  sessionResponseSchema,
} from "@brew-dashboard/contracts";
import { Client } from "pg";

import {
  AdminAccountError,
  MAX_ACTIVE_DEMO_ACCOUNTS,
  createAccount,
  deleteAccount,
  disableAccount,
  resetAccountPassword,
} from "../../src/admin/accounts.ts";
import { SESSION_COOKIE_NAME } from "../../src/auth/better-auth.ts";
import { __test as authHttpTest } from "../../src/auth/http.ts";
import { app } from "../../src/index.ts";
import { withRequestDatabase } from "../../src/db/client.ts";

const ownerUrl = process.env.DATABASE_TEST_URL;
const runtimeUrl = process.env.DATABASE_TEST_RUNTIME_URL;
const baseUrl = process.env.BETTER_AUTH_URL ?? "https://brew-dashboard.test";
const secret = process.env.BETTER_AUTH_SECRET ?? "stage3-integration-secret-".padEnd(32, "x");
const integrationEnvironment = {
  HYPERDRIVE: { connectionString: runtimeUrl ?? "" } as Hyperdrive,
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: baseUrl,
};

type TestAccount = Awaited<ReturnType<typeof createAccount>>;

const describeIntegration = describe.skipIf(!ownerUrl || !runtimeUrl);

describeIntegration("Stage 3 authentication and account administration", () => {
  const ownerClient = new Client({ connectionString: ownerUrl });
  const createdE2eAccounts: TestAccount[] = [];
  let accountA: TestAccount;
  let accountB: TestAccount;

  const createE2eAccount = async (login: string, password: string) => {
    const account = await withRequestDatabase(ownerUrl!, (db) =>
      createAccount(db, { login, password, accountKind: "e2e" }),
    );
    createdE2eAccounts.push(account);
    return account;
  };

  const parseSetCookies = (response: Response) => authHttpTest.getSetCookieValues(response.headers);

  const sessionCookie = (response: Response) => {
    const cookie = parseSetCookies(response).find((value) =>
      value.startsWith(`${SESSION_COOKIE_NAME}=`),
    );
    return cookie?.split(";", 1)[0];
  };

  const requireCookie = (cookie: string | undefined) => {
    if (!cookie) throw new Error("Expected Better Auth session cookie");
    return cookie;
  };

  const request = async (
    path: string,
    options: {
      method?: "GET" | "POST";
      body?: unknown;
      cookie?: string;
      ip?: string;
    } = {},
  ) => {
    const headers = new Headers();
    if (options.cookie) headers.set("cookie", options.cookie);
    if (options.ip) headers.set("cf-connecting-ip", options.ip);
    if (options.method === "POST") {
      headers.set("origin", baseUrl);
      headers.set("content-type", "application/json");
    }
    const init: RequestInit = { method: options.method ?? "GET", headers };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    return app.request(new URL(path, baseUrl), init, integrationEnvironment);
  };

  const login = async (account: TestAccount, ip: string) => {
    const response = await request("/api/v1/auth/login", {
      method: "POST",
      body: { login: account.login, password: account.password },
      ip,
    });
    return { response, cookie: sessionCookie(response) };
  };

  const errorBody = async (response: Response) =>
    apiErrorResponseSchema.parse(await response.json());

  const activeDemoCount = async () => {
    const result = await ownerClient.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM app.app_users
       WHERE account_kind = 'demo'
         AND status = 'active'
         AND (expires_at IS NULL OR expires_at > now())`,
    );
    return Number(result.rows[0]?.count ?? 0);
  };

  beforeAll(async () => {
    await ownerClient.connect();
    const suffix = crypto.randomUUID().slice(0, 8);
    accountA = await createE2eAccount(`stage3-a-${suffix}`, "Stage3-account-A1");
    accountB = await createE2eAccount(`stage3-b-${suffix}`, "Stage3-account-B1");
  });

  afterAll(async () => {
    for (const account of createdE2eAccounts) {
      await withRequestDatabase(ownerUrl!, async (db) => {
        try {
          await deleteAccount(db, { login: account.login, accountKind: "e2e" });
        } catch (error) {
          if (!(error instanceof AdminAccountError)) throw error;
        }
      });
    }
    await ownerClient.end();
  });

  it("creates a technical identity with an empty tenant and no public email flow", async () => {
    const result = await ownerClient.query<{
      email: string;
      username: string | null;
      network_name: string | null;
      locations: string;
      account_kind: string;
    }>(
      `SELECT au.email, au.username, n.name AS network_name,
              count(l.id)::text AS locations, app.account_kind
       FROM auth.users au
       JOIN app.app_users app ON app.auth_user_id = au.id
       JOIN app.networks n ON n.id = app.network_id
       LEFT JOIN app.locations l ON l.network_id = n.id
       WHERE app.login_normalized = $1
       GROUP BY au.email, au.username, n.name, app.account_kind`,
      [accountA.login],
    );
    const row = result.rows[0];
    expect(row?.email).toMatch(/@accounts\.brew-dashboard\.invalid$/u);
    expect(row?.username).toBe(accountA.login);
    expect(row?.network_name).toBeNull();
    expect(row?.locations).toBe("0");
    expect(row?.account_kind).toBe("e2e");

    const rawAuth = await request("/api/v1/internal-auth/sign-up/email");
    expect(rawAuth.status).toBe(404);
  });

  it("logs in with a secure opaque cookie and derives tenant identity server-side", async () => {
    const first = await login(accountA, "198.51.100.31");
    expect(first.response.status).toBe(200);
    expect(first.cookie).toBeTruthy();
    expect(first.cookie).not.toContain(accountA.password);
    const cookieHeader = parseSetCookies(first.response).find((value) =>
      value.startsWith(`${SESSION_COOKIE_NAME}=`),
    );
    expect(cookieHeader).toContain("HttpOnly");
    expect(cookieHeader).toContain("Secure");
    expect(cookieHeader).toContain("SameSite=Strict");
    expect(cookieHeader).toContain("Path=/");

    const body = sessionResponseSchema.parse(await first.response.json());
    expect(body.data.profile.login).toBe(accountA.login);
    expect(body.data.profile.networkId).not.toBe(accountB.networkId);
    expect(body.data.profile.networkName).toBeNull();
    expect(body.data.profile.tourState).toBe("pending");
    expect(JSON.stringify(body)).not.toContain("brew-dashboard.invalid");

    const me = await request("/api/v1/auth/me", { cookie: requireCookie(first.cookie) });
    expect(me.status).toBe(200);
    const meBody = sessionResponseSchema.parse(await me.json());
    expect(meBody.data.profile.networkId).toBe(accountA.networkId);

    const forged = await request("/api/v1/auth/login", {
      method: "POST",
      body: { login: accountA.login, password: accountA.password, networkId: accountB.networkId },
      ip: "198.51.100.32",
    });
    expect(forged.status).toBe(401);
    expect((await errorBody(forged)).error.message).toBe("Invalid login or password");
  });

  it("renews an old database session, rejects expiry, and clears the cookie", async () => {
    const loggedIn = await login(accountA, "198.51.100.33");
    expect(loggedIn.cookie).toBeTruthy();
    await ownerClient.query(
      `UPDATE auth.sessions
       SET updated_at = now() - interval '2 days', expires_at = now() + interval '5 days'
       WHERE user_id = $1`,
      [accountA.authUserId],
    );
    const renewed = await request("/api/v1/auth/me", { cookie: requireCookie(loggedIn.cookie) });
    expect(renewed.status).toBe(200);
    const sustained = await Promise.all(
      Array.from({ length: 25 }, () =>
        request("/api/v1/auth/me", { cookie: requireCookie(loggedIn.cookie) }),
      ),
    );
    expect(sustained.every((response) => response.status === 200)).toBe(true);
    const renewal = await ownerClient.query<{ updated_at: Date; expires_at: Date }>(
      `SELECT updated_at, expires_at
       FROM auth.sessions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
      [accountA.authUserId],
    );
    expect(renewal.rows[0]?.updated_at.getTime()).toBeGreaterThan(Date.now() - 86_400_000);
    expect(renewal.rows[0]?.expires_at.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);

    await ownerClient.query(
      `UPDATE auth.sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1`,
      [accountA.authUserId],
    );
    const expired = await request("/api/v1/auth/me", { cookie: requireCookie(loggedIn.cookie) });
    expect(expired.status).toBe(401);
    expect(parseSetCookies(expired).some((value) => value.includes("Max-Age=0"))).toBe(true);
  });

  it("logs out idempotently and revokes the current database session", async () => {
    const loggedIn = await login(accountA, "198.51.100.34");
    expect(loggedIn.cookie).toBeTruthy();
    const logout = await request("/api/v1/auth/logout", {
      method: "POST",
      body: {},
      cookie: requireCookie(loggedIn.cookie),
      ip: "198.51.100.34",
    });
    expect(logout.status).toBe(200);
    expect(logoutResponseSchema.parse(await logout.json()).data.authenticated).toBe(false);
    expect(parseSetCookies(logout).some((value) => value.includes("Max-Age=0"))).toBe(true);
    expect(
      (await request("/api/v1/auth/me", { cookie: requireCookie(loggedIn.cookie) })).status,
    ).toBe(401);

    const repeat = await request("/api/v1/auth/logout", {
      method: "POST",
      body: {},
      ip: "198.51.100.34",
    });
    expect(repeat.status).toBe(200);
  });

  it("keeps invalid credentials generic and revokes sessions on reset/disable", async () => {
    const loggedIn = await login(accountA, "198.51.100.35");
    expect(loggedIn.cookie).toBeTruthy();
    const reset = await withRequestDatabase(ownerUrl!, (db) =>
      resetAccountPassword(db, {
        login: accountA.login,
        password: "Stage3-reset-A1",
        accountKind: "e2e",
      }),
    );
    expect(reset.password).toBe("Stage3-reset-A1");
    expect(
      (await request("/api/v1/auth/me", { cookie: requireCookie(loggedIn.cookie) })).status,
    ).toBe(401);

    const oldPassword = await request("/api/v1/auth/login", {
      method: "POST",
      body: { login: accountA.login, password: accountA.password },
      ip: "198.51.100.36",
    });
    const missingLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: { login: "missing-stage3", password: "Stage3-reset-A1" },
      ip: "198.51.100.37",
    });
    expect(oldPassword.status).toBe(401);
    expect(missingLogin.status).toBe(401);
    const oldPasswordBody = await errorBody(oldPassword);
    const missingLoginBody = await errorBody(missingLogin);
    expect(oldPasswordBody.error).toEqual(missingLoginBody.error);
    expect(oldPasswordBody.requestId).not.toBe(missingLoginBody.requestId);
    expect(
      (await login({ ...accountA, password: reset.password }, "198.51.100.38")).response.status,
    ).toBe(200);

    const second = await login(accountB, "198.51.100.39");
    expect(second.cookie).toBeTruthy();
    await withRequestDatabase(ownerUrl!, (db) =>
      disableAccount(db, { login: accountB.login, accountKind: "e2e" }),
    );
    expect(
      (await request("/api/v1/auth/me", { cookie: requireCookie(second.cookie) })).status,
    ).toBe(401);
    expect((await login(accountB, "198.51.100.40")).response.status).toBe(401);
  });

  it("rejects an expired account and applies per-login and IP login rate limits", async () => {
    const expiring = await createE2eAccount(
      `stage3-expired-${crypto.randomUUID().slice(0, 8)}`,
      "Stage3-expired-A1",
    );
    await ownerClient.query(
      `UPDATE app.app_users SET expires_at = now() - interval '1 second' WHERE auth_user_id = $1`,
      [expiring.authUserId],
    );
    expect((await login(expiring, "198.51.100.41")).response.status).toBe(401);

    const rateAccount = await createE2eAccount(
      `stage3-rate-${crypto.randomUUID().slice(0, 8)}`,
      "Stage3-rate-account-A1",
    );
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        request("/api/v1/auth/login", {
          method: "POST",
          body: { login: rateAccount.login.toUpperCase(), password: "wrong-password-123" },
          ip: `198.51.100.${42 + index}`,
        }),
      ),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 401)).toHaveLength(10);
    const rateLimited = await request("/api/v1/auth/login", {
      method: "POST",
      body: { login: rateAccount.login, password: rateAccount.password },
      ip: "198.51.100.60",
    });
    expect(rateLimited.status).toBe(429);
    expect(Number(rateLimited.headers.get("retry-after"))).toBeGreaterThan(0);

    const aliasesFromOneIp = await Promise.all(
      Array.from({ length: 51 }, (_, index) =>
        request("/api/v1/auth/login", {
          method: "POST",
          body: {
            login: `stage3-alias-${index}-${crypto.randomUUID().slice(0, 8)}`,
            password: "wrong-password-123",
          },
          // Keep this IP independent from the expired-account assertion above:
          // the limiter intentionally counts every login attempt, successful or not.
          ip: "198.51.100.61",
        }),
      ),
    );
    expect(aliasesFromOneIp.filter((response) => response.status === 429)).toHaveLength(1);
  });

  it("clears a login failure bucket after a successful authentication", async () => {
    const account = await createE2eAccount(
      `stage3-reset-limit-${crypto.randomUUID().slice(0, 8)}`,
      "Stage3-reset-limit-A1",
    );
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const rejected = await request("/api/v1/auth/login", {
        method: "POST",
        body: { login: account.login, password: "wrong-password-123" },
        ip: `198.51.101.${attempt + 1}`,
      });
      expect(rejected.status).toBe(401);
    }
    expect((await login(account, "198.51.101.3")).response.status).toBe(200);

    const afterReset = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        request("/api/v1/auth/login", {
          method: "POST",
          body: { login: account.login, password: "wrong-password-123" },
          ip: `198.51.101.${index + 10}`,
        }),
      ),
    );
    expect(afterReset.every((response) => response.status === 401)).toBe(true);
  });

  it("serializes the fifteen-active-demo cap while excluding e2e accounts", async () => {
    const current = await activeDemoCount();
    expect(current).toBeLessThan(MAX_ACTIVE_DEMO_ACCOUNTS);
    const fillers: TestAccount[] = [];
    for (let index = current; index < MAX_ACTIVE_DEMO_ACCOUNTS - 1; index += 1) {
      const filler = await withRequestDatabase(ownerUrl!, (db) =>
        createAccount(db, {
          login: `stage3-demo-${crypto.randomUUID().slice(0, 8)}`,
          password: `test-${index}-${crypto.randomUUID()}`,
          accountKind: "demo",
        }),
      );
      fillers.push(filler);
    }
    expect(await activeDemoCount()).toBe(MAX_ACTIVE_DEMO_ACCOUNTS - 1);

    const attempts = await Promise.allSettled([
      withRequestDatabase(ownerUrl!, (db) =>
        createAccount(db, {
          login: `stage3-cap-${crypto.randomUUID().slice(0, 8)}`,
          password: "Stage3-cap-one-A1",
          accountKind: "demo",
        }),
      ),
      withRequestDatabase(ownerUrl!, (db) =>
        createAccount(db, {
          login: `stage3-cap-${crypto.randomUUID().slice(0, 8)}`,
          password: "Stage3-cap-two-A1",
          accountKind: "demo",
        }),
      ),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect(await activeDemoCount()).toBe(MAX_ACTIVE_DEMO_ACCOUNTS);
    expect(fillers.length).toBeGreaterThan(0);
  });
});
