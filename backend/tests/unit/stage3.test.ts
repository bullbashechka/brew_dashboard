import { describe, expect, it } from "bun:test";

import {
  parseAccountKind,
  parseExpiry,
  requireExactConfirmation,
} from "../../scripts/admin-common.ts";
import { generatePassword } from "../../src/admin/accounts.ts";
import { __test as authHttpTest } from "../../src/auth/http.ts";
import { isSupportedLogin, normalizeLogin, parsePassword } from "../../src/auth/login.ts";
import { app } from "../../src/index.ts";
import { __test as middlewareTest } from "../../src/http/middleware.ts";

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
  });

  it("generates a password within the shared credential bounds", () => {
    const password = generatePassword();
    expect(password.length).toBeGreaterThanOrEqual(12);
    expect(password.length).toBeLessThanOrEqual(128);
    expect(() => parsePassword("")).toThrow();
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
