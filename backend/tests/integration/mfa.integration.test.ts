import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  apiErrorResponseSchema,
  authMeResponseSchema,
  mfaChallengeResponseSchema,
  mfaSetupRequiredResponseSchema,
  mfaSetupResponseSchema,
  sessionResponseSchema,
} from "@brew-dashboard/contracts";
import { Client } from "pg";

import {
  createAccount,
  deleteAccount,
  disableAccount,
  resetAccountMfa,
  resetAccountPassword,
} from "../../src/admin/accounts.ts";
import { __test as authHttpTest } from "../../src/auth/http.ts";
import { withRequestDatabase } from "../../src/db/client.ts";
import { app } from "../../src/index.ts";
import { generateTotp } from "../helpers/totp.ts";

const ownerUrl = process.env.DATABASE_TEST_URL;
const runtimeUrl = process.env.DATABASE_TEST_RUNTIME_URL;
const authRuntimeUrl = process.env.DATABASE_TEST_AUTH_RUNTIME_URL;
const appRuntimeUrl = process.env.DATABASE_TEST_APP_RUNTIME_URL;
const baseUrl = "http://127.0.0.1:4173";
const secret = "mfa-postgres-integration-secret".padEnd(32, "x");
const allowAllRateLimits = {
  idFromName: () => ({}) as DurableObjectId,
  get: () => ({
    fetch: async () => Response.json({ allowed: true, retryAfter: null }),
  }),
} as unknown as DurableObjectNamespace;
const environment = {
  AUTH_HYPERDRIVE: { connectionString: authRuntimeUrl ?? "" } as Hyperdrive,
  APP_HYPERDRIVE: { connectionString: appRuntimeUrl ?? "" } as Hyperdrive,
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: baseUrl,
  MFA_REQUIRED: "1",
  RUNTIME_ROLE_SPLIT_STAGE: "B",
  RATE_LIMIT_ACTOR: allowAllRateLimits,
};

type TestAccount = Awaited<ReturnType<typeof createAccount>>;
const describeIntegration = describe.skipIf(
  !ownerUrl || !runtimeUrl || !authRuntimeUrl || !appRuntimeUrl,
);

describeIntegration("mandatory MFA PostgreSQL state machine", () => {
  const ownerClient = new Client({ connectionString: ownerUrl });
  const accounts: TestAccount[] = [];
  let account: TestAccount;

  const cookiesFrom = (response: Response) =>
    authHttpTest
      .getSetCookieValues(response.headers)
      .map((value) => value.split(";", 1)[0])
      .filter((value): value is string => Boolean(value && !value.endsWith("=")))
      .join("; ");

  const request = async (
    path: string,
    options: { method?: "GET" | "POST"; body?: unknown; cookie?: string; ip?: string } = {},
  ) => {
    const headers = new Headers();
    if (options.cookie) headers.set("cookie", options.cookie);
    if (options.ip) headers.set("cf-connecting-ip", options.ip);
    if (options.method === "POST") {
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

  const passwordLogin = (password = account.password) =>
    request("/api/v1/auth/login", {
      method: "POST",
      body: { login: account.login, password },
      ip: "198.51.100.201",
    });

  const challengeLogin = async () => {
    const response = await passwordLogin();
    expect(response.status).toBe(200);
    mfaChallengeResponseSchema.parse(await response.clone().json());
    const cookie = cookiesFrom(response);
    expect(cookie).not.toBe("");
    return cookie;
  };

  beforeAll(async () => {
    await ownerClient.connect();
    account = await withRequestDatabase(ownerUrl!, (db) =>
      createAccount(db, {
        login: `mfa-state-${crypto.randomUUID().slice(0, 8)}`,
        password: "Mfa-state-machine-A1",
        accountKind: "e2e",
      }),
    );
    accounts.push(account);
  });

  afterAll(async () => {
    for (const current of accounts) {
      await withRequestDatabase(ownerUrl!, (db) =>
        deleteAccount(db, { login: current.login, accountKind: "e2e" }),
      ).catch(() => undefined);
    }
    await ownerClient.end();
  });

  it("enforces enrollment, rotation, challenge, backup-code lockout and administrative revocation", async () => {
    const login = await passwordLogin();
    expect(login.status).toBe(200);
    const setupRequired = mfaSetupRequiredResponseSchema.parse(await login.clone().json());
    expect(setupRequired.data).toEqual({ mfaSetupRequired: true });
    expect(JSON.stringify(setupRequired)).not.toContain(account.authUserId);
    expect(JSON.stringify(setupRequired)).not.toContain(account.networkId);
    const preMfaCookie = cookiesFrom(login);
    expect(preMfaCookie).not.toBe("");
    const parallelPreMfaLogin = await passwordLogin();
    expect(parallelPreMfaLogin.status).toBe(200);
    const parallelPreMfaCookie = cookiesFrom(parallelPreMfaLogin);
    expect(parallelPreMfaCookie).not.toBe("");
    expect(parallelPreMfaCookie).not.toBe(preMfaCookie);

    const preMfaApp = await request("/api/v1/overview", { cookie: preMfaCookie });
    expect(preMfaApp.status).toBe(403);
    expect((await apiErrorResponseSchema.parseAsync(await preMfaApp.json())).error.code).toBe(
      "MFA_REQUIRED",
    );
    const reloaded = await request("/api/v1/auth/me", { cookie: preMfaCookie });
    expect(authMeResponseSchema.parse(await reloaded.json()).data).toEqual({
      mfaSetupRequired: true,
    });

    const beforeEnrollment = await ownerClient.query<{
      last_login_at: Date | null;
      login_events: string;
    }>(
      `SELECT app.last_login_at,
        (SELECT count(*)::text FROM app.product_events event
         WHERE event.user_id = app.id AND event.type = 'login_succeeded') AS login_events
       FROM app.app_users app WHERE app.auth_user_id = $1`,
      [account.authUserId],
    );
    expect(beforeEnrollment.rows[0]?.last_login_at).toBeNull();
    expect(beforeEnrollment.rows[0]?.login_events).toBe("0");

    const wrongPassword = await request("/api/v1/auth/mfa/setup", {
      method: "POST",
      body: { password: "Wrong-password-A1" },
      cookie: preMfaCookie,
    });
    expect(wrongPassword.status).toBe(401);
    const setupResponse = await request("/api/v1/auth/mfa/setup", {
      method: "POST",
      body: { password: account.password },
      cookie: preMfaCookie,
    });
    expect(setupResponse.status).toBe(200);
    const setup = mfaSetupResponseSchema.parse(await setupResponse.json()).data;
    const validTotp = generateTotp(setup.secret);
    const invalidTotp = `${validTotp.slice(0, -1)}${(Number(validTotp.at(-1)) + 1) % 10}`;

    const invalidVerification = await request("/api/v1/auth/mfa/verify", {
      method: "POST",
      body: { method: "totp", code: invalidTotp },
      cookie: preMfaCookie,
    });
    expect(invalidVerification.status).toBe(401);

    const verified = await request("/api/v1/auth/mfa/verify", {
      method: "POST",
      body: { method: "totp", code: validTotp },
      cookie: preMfaCookie,
    });
    expect(verified.status).toBe(200);
    sessionResponseSchema.parse(await verified.clone().json());
    const verifiedCookie = cookiesFrom(verified);
    expect(verifiedCookie).not.toBe("");
    expect((await request("/api/v1/auth/me", { cookie: preMfaCookie })).status).toBe(401);
    expect((await request("/api/v1/auth/me", { cookie: parallelPreMfaCookie })).status).toBe(401);
    const fullSession = await request("/api/v1/auth/me", { cookie: verifiedCookie });
    expect(sessionResponseSchema.parse(await fullSession.json()).data.profile.login).toBe(
      account.login,
    );

    const completedLogin = await ownerClient.query<{ login_events: string }>(
      `SELECT count(*)::text AS login_events FROM app.product_events event
       JOIN app.app_users app ON app.id = event.user_id
       WHERE app.auth_user_id = $1 AND event.type = 'login_succeeded'`,
      [account.authUserId],
    );
    expect(completedLogin.rows[0]?.login_events).toBe("1");

    const repeatedVerification = await request("/api/v1/auth/mfa/verify", {
      method: "POST",
      body: { method: "totp", code: generateTotp(setup.secret) },
      cookie: verifiedCookie,
    });
    expect(repeatedVerification.status).toBe(401);
    const afterRepeatedVerification = await ownerClient.query<{ login_events: string }>(
      `SELECT count(*)::text AS login_events FROM app.product_events event
       JOIN app.app_users app ON app.id = event.user_id
       WHERE app.auth_user_id = $1 AND event.type = 'login_succeeded'`,
      [account.authUserId],
    );
    expect(afterRepeatedVerification.rows[0]?.login_events).toBe("1");

    const logout = await request("/api/v1/auth/logout", {
      method: "POST",
      body: {},
      cookie: verifiedCookie,
    });
    expect(logout.status).toBe(200);
    expect((await request("/api/v1/auth/me", { cookie: verifiedCookie })).status).toBe(401);

    const totpChallengeCookie = await challengeLogin();
    const challenged = await request("/api/v1/auth/mfa/verify", {
      method: "POST",
      body: { method: "totp", code: generateTotp(setup.secret) },
      cookie: totpChallengeCookie,
    });
    expect(challenged.status).toBe(200);

    const backupCode = setup.backupCodes[0]!;
    const backupChallengeCookie = await challengeLogin();
    const backupVerified = await request("/api/v1/auth/mfa/verify", {
      method: "POST",
      body: { method: "backup", code: backupCode },
      cookie: backupChallengeCookie,
    });
    expect(backupVerified.status).toBe(200);
    const backupSessionCookie = cookiesFrom(backupVerified);

    const reusedChallengeCookie = await challengeLogin();
    const reused = await request("/api/v1/auth/mfa/verify", {
      method: "POST",
      body: { method: "backup", code: backupCode },
      cookie: reusedChallengeCookie,
    });
    expect(reused.status).toBe(401);

    const lockoutCookie = await challengeLogin();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rejected = await request("/api/v1/auth/mfa/verify", {
        method: "POST",
        body: { method: "totp", code: invalidTotp },
        cookie: lockoutCookie,
      });
      expect([401, 429]).toContain(rejected.status);
    }
    const locked = await ownerClient.query<{
      failed_verification_count: number;
      locked_until: Date | null;
    }>(`SELECT failed_verification_count, locked_until FROM auth.two_factor WHERE user_id = $1`, [
      account.authUserId,
    ]);
    expect(locked.rows[0]?.failed_verification_count).toBeGreaterThanOrEqual(5);
    expect(locked.rows[0]?.locked_until?.getTime()).toBeGreaterThan(Date.now());

    await ownerClient.query(
      "UPDATE auth.two_factor SET locked_until = now() - interval '1 second' WHERE user_id = $1",
      [account.authUserId],
    );
    const recovered = await request("/api/v1/auth/mfa/verify", {
      method: "POST",
      body: { method: "totp", code: generateTotp(setup.secret) },
      cookie: lockoutCookie,
    });
    expect(recovered.status).toBe(200);
    const recoveredState = await ownerClient.query<{
      failed_verification_count: number;
      locked_until: Date | null;
    }>(`SELECT failed_verification_count, locked_until FROM auth.two_factor WHERE user_id = $1`, [
      account.authUserId,
    ]);
    expect(recoveredState.rows[0]?.failed_verification_count).toBe(0);
    expect(recoveredState.rows[0]?.locked_until).toBeNull();

    const passwordResetChallengeCookie = await challengeLogin();
    const newPassword = "Mfa-reset-password-A1";
    await withRequestDatabase(ownerUrl!, (db) =>
      resetAccountPassword(db, {
        login: account.login,
        password: newPassword,
        accountKind: "e2e",
      }),
    );
    const staleChallenge = await request("/api/v1/auth/mfa/verify", {
      method: "POST",
      body: { method: "totp", code: generateTotp(setup.secret) },
      cookie: passwordResetChallengeCookie,
    });
    expect(staleChallenge.status).toBe(401);
    expect((await passwordLogin()).status).toBe(401);
    account = { ...account, password: newPassword };
    expect(mfaChallengeResponseSchema.parse(await (await passwordLogin()).json()).data).toEqual({
      mfaRequired: true,
      methods: ["totp"],
    });

    await withRequestDatabase(ownerUrl!, (db) =>
      resetAccountMfa(db, { login: account.login, accountKind: "e2e" }),
    );
    expect((await request("/api/v1/auth/me", { cookie: backupSessionCookie })).status).toBe(401);
    const afterMfaReset = await passwordLogin();
    expect(mfaSetupRequiredResponseSchema.parse(await afterMfaReset.clone().json()).data).toEqual({
      mfaSetupRequired: true,
    });
    const resetPreMfaCookie = cookiesFrom(afterMfaReset);
    expect((await request("/api/v1/overview", { cookie: resetPreMfaCookie })).status).toBe(403);
    expect(mfaSetupRequiredResponseSchema.parse(await (await passwordLogin()).json()).data).toEqual(
      { mfaSetupRequired: true },
    );

    const forgedTenant = await request("/api/v1/auth/login", {
      method: "POST",
      body: { login: account.login, password: newPassword, networkId: crypto.randomUUID() },
      ip: "198.51.100.202",
    });
    expect(forgedTenant.status).toBe(401);

    const expired = await withRequestDatabase(ownerUrl!, (db) =>
      createAccount(db, {
        login: `mfa-expired-${crypto.randomUUID().slice(0, 8)}`,
        password: "Mfa-expired-account-A1",
        accountKind: "e2e",
      }),
    );
    accounts.push(expired);
    await ownerClient.query(
      "UPDATE app.app_users SET expires_at = now() - interval '1 second' WHERE auth_user_id = $1",
      [expired.authUserId],
    );
    expect(
      (
        await request("/api/v1/auth/login", {
          method: "POST",
          body: { login: expired.login, password: expired.password },
          ip: "198.51.100.203",
        })
      ).status,
    ).toBe(401);

    const disabled = await withRequestDatabase(ownerUrl!, (db) =>
      createAccount(db, {
        login: `mfa-disabled-${crypto.randomUUID().slice(0, 8)}`,
        password: "Mfa-disabled-account-A1",
        accountKind: "e2e",
      }),
    );
    accounts.push(disabled);
    await withRequestDatabase(ownerUrl!, (db) =>
      disableAccount(db, { login: disabled.login, accountKind: "e2e" }),
    );
    expect(
      (
        await request("/api/v1/auth/login", {
          method: "POST",
          body: { login: disabled.login, password: disabled.password },
          ip: "198.51.100.204",
        })
      ).status,
    ).toBe(401);
  });
});
