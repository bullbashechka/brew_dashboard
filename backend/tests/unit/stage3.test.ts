import { describe, expect, it } from "bun:test";

import {
  assertInteractivePasswordAllowed,
  parseAccountKind,
  parseExpiry,
  requireExactConfirmation,
} from "../../scripts/admin-common.ts";
import { assertE2eAccountKind } from "../../scripts/test-safety.ts";
import { generatePassword } from "../../src/admin/accounts.ts";
import { __test as authHttpTest } from "../../src/auth/http.ts";
import { isSupportedLogin, normalizeLogin, parsePassword } from "../../src/auth/login.ts";
import { app } from "../../src/index.ts";
import { __test as middlewareTest } from "../../src/http/middleware.ts";
import { isLoopbackHostname } from "../../src/security/hosts.ts";

describe("Stage 3 login and admin boundaries", () => {
  it("normalizes valid aliases and rejects unsupported characters", () => {
    expect(normalizeLogin("  Demo.Owner-1 ")).toBe("demo.owner-1");
    expect(isSupportedLogin("demo.owner-1")).toBe(true);
    expect(isSupportedLogin("demo owner")).toBe(false);
    expect(isSupportedLogin("x")).toBe(false);
  });

  it("uses exact canonical confirmation and validates account kind/expiry", () => {
    expect(() => requireExactConfirmation("Demo.Owner", "demo.owner")).not.toThrow();
    expect(() => requireExactConfirmation("Demo.Owner", "Demo.Owner")).toThrow();
    expect(parseAccountKind("demo")).toBe("demo");
    expect(parseAccountKind("e2e")).toBe("e2e");
    expect(() => parseAccountKind("production")).toThrow();
    expect(parseExpiry("2030-01-01T00:00:00Z")).toBeInstanceOf(Date);
    expect(() => parseExpiry("2030-01-01T00:00:00")).toThrow();
    expect(() => assertE2eAccountKind("demo")).toThrow();
    expect(() => assertE2eAccountKind(undefined)).toThrow();
    expect(() => assertE2eAccountKind("e2e")).not.toThrow();
    expect(() =>
      assertInteractivePasswordAllowed("postgresql://localhost/brew", true),
    ).not.toThrow();
    expect(() => assertInteractivePasswordAllowed("postgresql://db.example/brew", true)).toThrow(
      "loopback",
    );
    const previousTarget = process.env.DATABASE_TARGET_ENVIRONMENT;
    process.env.DATABASE_TARGET_ENVIRONMENT = "production";
    try {
      expect(() => assertInteractivePasswordAllowed("postgresql://localhost/brew", true)).toThrow(
        "loopback",
      );
    } finally {
      if (previousTarget === undefined) delete process.env.DATABASE_TARGET_ENVIRONMENT;
      else process.env.DATABASE_TARGET_ENVIRONMENT = previousTarget;
    }
  });

  it("generates a password within the shared credential bounds", () => {
    const password = generatePassword();
    expect(password.length).toBeGreaterThanOrEqual(12);
    expect(password.length).toBeLessThanOrEqual(128);
    expect(() => parsePassword("")).toThrow();
  });

  it("allows HTTPS exceptions only for loopback hosts", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("203.0.113.10")).toBe(false);
  });

  it("keeps unexpected Better Auth responses as internal failures", () => {
    expect(() =>
      authHttpTest.classifyAuthResponse("login", new Response(null, { status: 503 })),
    ).toThrow("Better Auth login returned unexpected HTTP 503");
    expect(() =>
      authHttpTest.classifyAuthResponse("get-session", new Response(null, { status: 502 })),
    ).toThrow("Better Auth get-session returned unexpected HTTP 502");
    expect(authHttpTest.classifyAuthResponse("login", new Response(null, { status: 401 }))).toEqual(
      { kind: "unauthenticated" },
    );
  });

  it("normalizes only the supported MFA methods and accepts only otpauth TOTP secrets", () => {
    expect(authHttpTest.mfaMethodsFor(["totp", "backup_code", "sms", "totp"])).toEqual([
      "totp",
      "backup",
    ]);
    expect(authHttpTest.mfaMethodsFor(["sms"])).toEqual([]);
    expect(
      authHttpTest.totpSecretFromUri(
        "otpauth://totp/Brew%20Dashboard:user?secret=JBSWY3DPEHPK3PXP",
      ),
    ).toBe("JBSWY3DPEHPK3PXP");
    expect(authHttpTest.totpSecretFromUri("https://example.test/?secret=JBSWY3DPEHPK3PXP")).toBe(
      null,
    );
    expect(authHttpTest.totpSecretFromUri("otpauth://totp/Brew%20Dashboard:user?secret=bad0")).toBe(
      null,
    );
    expect(authHttpTest.mfaRequiredFor({ MFA_REQUIRED: "1" } as never)).toBe(true);
    expect(
      authHttpTest.mfaRequiredFor({
        MFA_REQUIRED: "0",
        BETTER_AUTH_URL: "http://127.0.0.1:4173",
      } as never),
    ).toBe(false);
    for (const value of [undefined, "true", "false", "unexpected"]) {
      expect(() =>
        authHttpTest.mfaRequiredFor({
          ...(value === undefined ? {} : { MFA_REQUIRED: value }),
          BETTER_AUTH_URL: "http://127.0.0.1:4173",
        } as never),
      ).toThrow();
    }
    expect(() =>
      authHttpTest.mfaRequiredFor({
        MFA_REQUIRED: "0",
        BETTER_AUTH_URL: "https://brew-dashboard.example",
      } as never),
    ).toThrow();
  });

  it("enforces JSON, origin and body boundaries for mutations", async () => {
    expect(middlewareTest.isJsonContentType("application/json; charset=utf-8")).toBe(true);
    expect(middlewareTest.isJsonContentType("text/plain")).toBe(false);

    const missingOrigin = await app.request("http://localhost/api/v1/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(missingOrigin.status).toBe(403);

    const wrongMediaType = await app.request("http://localhost/api/v1/auth/logout", {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "text/plain" },
      body: "{}",
    });
    expect(wrongMediaType.status).toBe(415);

    const oversized = await app.request("http://localhost/api/v1/auth/logout", {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(middlewareTest.JSON_BODY_LIMIT) }),
    });
    expect(oversized.status).toBe(413);
  });

  it("fails closed when BETTER_AUTH_URL is malformed without logging its value", async () => {
    const records: unknown[] = [];
    const originalError = console.error;
    console.error = ((record: unknown) => records.push(record)) as typeof console.error;
    try {
      const response = await app.request(
        "http://localhost/api/v1/auth/logout",
        {
          method: "POST",
          headers: { origin: "http://localhost", "content-type": "application/json" },
          body: "{}",
        },
        { BETTER_AUTH_URL: "not a valid configured URL" } as never,
      );
      expect(response.status).toBe(500);
      expect((await response.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "INTERNAL_ERROR" },
      });
    } finally {
      console.error = originalError;
    }
    expect(JSON.stringify(records)).not.toContain("not a valid configured URL");
  });

  it("keeps a valid configured URL with a mismatched Origin forbidden", async () => {
    const response = await app.request(
      "http://localhost/api/v1/auth/logout",
      {
        method: "POST",
        headers: { origin: "http://localhost", "content-type": "application/json" },
        body: "{}",
      },
      { BETTER_AUTH_URL: "https://brew-dashboard.example" } as never,
    );
    expect(response.status).toBe(403);
  });

  it("keeps malformed login credentials generic at the route validation boundary", async () => {
    const response = await app.request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ login: "valid-alias", password: "123456789012", networkId: "forged" }),
    });
    const body = (await response.json()) as {
      error: { code: string; fields: Record<string, string[]>; message: string };
    };
    expect(response.status).toBe(401);
    expect(body.error).toEqual({
      code: "UNAUTHENTICATED",
      fields: {},
      message: "Invalid login or password",
    });
  });

  it("maps malformed JSON to the same generic login error", async () => {
    const response = await app.request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: "{",
    });
    const body = (await response.json()) as {
      error: { code: string; fields: Record<string, string[]>; message: string };
    };
    expect(response.status).toBe(401);
    expect(body.error).toEqual({
      code: "UNAUTHENTICATED",
      fields: {},
      message: "Invalid login or password",
    });
  });

  it("keeps one request id in successful and not-found responses and hides raw auth routes", async () => {
    const health = await app.request("http://localhost/api/v1/health", {
      headers: { "x-request-id": "00000000-0000-0000-0000-000000000000" },
    });
    const healthBody = (await health.json()) as { requestId: string };
    expect(health.headers.get("x-request-id")).toBe(healthBody.requestId);
    expect(healthBody.requestId).not.toBe("00000000-0000-0000-0000-000000000000");

    const raw = await app.request("http://localhost/api/v1/internal-auth/sign-up/email");
    expect(raw.status).toBe(404);
    const rawBody = (await raw.json()) as { requestId: string };
    expect(raw.headers.get("x-request-id")).toBe(rawBody.requestId);

    const outsideApi = await app.request("http://localhost/api/v2/not-found");
    const outsideBody = (await outsideApi.json()) as { requestId: string };
    expect(outsideApi.status).toBe(404);
    expect(outsideApi.headers.get("x-request-id")).toBe(outsideBody.requestId);
  });

  it("applies the required security headers to every API response", async () => {
    const response = await app.request("http://localhost/api/v1/health");
    for (const [name, value] of Object.entries(middlewareTest.SECURITY_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(middlewareTest.signalsFor("/api/v1/auth/login", 401)[0]).toBe("login_failure");
    expect(middlewareTest.signalsFor("/api/v1/onboarding/complete", 409)[0]).toBe(
      "onboarding_failure",
    );
    expect(middlewareTest.signalsFor("/api/v1/demo/reset", 500)[0]).toBe("server_error");
    expect(middlewareTest.signalsFor("/api/v1/demo/reset", 500)).toEqual([
      "server_error",
      "reset_failure",
    ]);
    expect(middlewareTest.signalsFor("/api/v1/auth/login", 500)).toEqual([
      "server_error",
      "login_failure",
    ]);
    expect(middlewareTest.signalsFor("/api/v1/auth/mfa/verify", 401)).toEqual(["mfa_failure"]);
    expect(middlewareTest.normalizeRoutePattern("/api/v1/products/:productId/price")).toBe(
      "/api/v1/products/:productId/price",
    );
    expect(middlewareTest.normalizeRoutePattern("/api/v1/*")).toBe("unmatched");
    expect(
      middlewareTest.shouldLogRequest("unmatched", 404, "00000000-0000-0000-0000-000000000000"),
    ).toBe(true);
    expect(
      middlewareTest.shouldLogRequest("unmatched", 404, "ffffffff-ffff-ffff-ffff-ffffffffffff"),
    ).toBe(false);
    expect(
      middlewareTest.shouldLogRequest("unmatched", 500, "ffffffff-ffff-ffff-ffff-ffffffffffff"),
    ).toBe(true);
  });

  it("emits structured telemetry without request contents or secrets", async () => {
    const records: unknown[] = [];
    const originalLog = console.log;
    console.log = ((record: unknown) => records.push(record)) as typeof console.log;
    try {
      await app.request("http://localhost/api/v1/health");
    } finally {
      console.log = originalLog;
    }
    const record = records.find((value): value is Record<string, unknown> =>
      Boolean(value && typeof value === "object" && "event" in value),
    );
    expect(record).toMatchObject({
      event: "http_request_completed.v1",
      route: "/api/v1/health",
      method: "GET",
      status: 200,
      signal: "request",
    });
    expect(record).not.toHaveProperty("body");
    expect(JSON.stringify(record)).not.toContain("password");
    expect(JSON.stringify(record)).not.toContain("feedback");
  });

  it("normalizes handled 5xx routes and emits one failure record", async () => {
    const records: unknown[] = [];
    const originalError = console.error;
    console.error = ((record: unknown) => records.push(record)) as typeof console.error;
    try {
      const response = await app.request("http://localhost/api/v1/products/customer-secret/price");
      expect(response.status).toBe(500);
    } finally {
      console.error = originalError;
    }

    const failureRecords = records.filter((value): value is Record<string, unknown> =>
      Boolean(value && typeof value === "object" && "event" in value),
    );
    expect(failureRecords).toHaveLength(1);
    expect(failureRecords[0]).toMatchObject({
      event: "http_request_failed.v1",
      route: "/api/v1/products/:productId/price",
      status: 500,
      signal: "server_error",
    });
    expect(JSON.stringify(failureRecords[0])).not.toContain("customer-secret");
  });
});

describe("Stage 3 cookie parsing", () => {
  it("preserves separate Set-Cookie values when Expires contains commas", () => {
    const values = authHttpTest.getSetCookieValues(
      new Headers({
        "set-cookie": "a=1; Expires=Wed, 21 Oct 2030 07:28:00 GMT; Path=/, b=2; Path=/; HttpOnly",
      }),
    );
    expect(values).toHaveLength(2);
    expect(values[0]).toStartWith("a=1;");
    expect(values[1]).toStartWith("b=2;");
  });
});
