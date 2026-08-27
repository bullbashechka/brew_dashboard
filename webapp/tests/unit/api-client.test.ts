import { afterEach, describe, expect, it, mock } from "bun:test";
import { healthResponseSchema } from "@brew-dashboard/contracts";
import { requestApi, setSessionExpiredHandler } from "../../src/api/client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  setSessionExpiredHandler(null);
});

describe("requestApi", () => {
  it("parses a shared success envelope", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: { status: "ok" },
            meta: {},
            requestId: "123e4567-e89b-12d3-a456-426614174000",
          }),
          { status: 200 },
        ),
      ),
    ) as unknown as typeof fetch;
    await expect(
      requestApi({ path: "/api/v1/health", schema: healthResponseSchema }),
    ).resolves.toMatchObject({ data: { status: "ok" } });
  });

  it("keeps the validated request id on an API error", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: "FORBIDDEN", message: "internal text", fields: {} },
            requestId: "123e4567-e89b-12d3-a456-426614174000",
          }),
          { status: 403 },
        ),
      ),
    ) as unknown as typeof fetch;
    await expect(
      requestApi({ path: "/api/v1/health", schema: healthResponseSchema }),
    ).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      requestId: "123e4567-e89b-12d3-a456-426614174000",
    });
  });

  it("keeps a valid Retry-After value on a rate-limit error", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: "RATE_LIMITED", message: "try later", fields: {} },
            requestId: "123e4567-e89b-12d3-a456-426614174000",
          }),
          { status: 429, headers: { "retry-after": "2" } },
        ),
      ),
    ) as unknown as typeof fetch;
    await expect(
      requestApi({ path: "/api/v1/health", schema: healthResponseSchema }),
    ).rejects.toMatchObject({ status: 429, retryAfterSeconds: 2 });
  });

  it("handles concurrent confirmed-session 401 responses once", async () => {
    let calls = 0;
    setSessionExpiredHandler(async () => {
      calls += 1;
    });
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: "UNAUTHENTICATED", message: "expired", fields: {} },
            requestId: "123e4567-e89b-12d3-a456-426614174000",
          }),
          { status: 401 },
        ),
      ),
    ) as unknown as typeof fetch;
    await Promise.allSettled([
      requestApi({ path: "/api/v1/health", schema: healthResponseSchema }),
      requestApi({ path: "/api/v1/health", schema: healthResponseSchema }),
    ]);
    expect(calls).toBe(1);
  });

  it("does not promote guest 401 to a session expiry", async () => {
    let calls = 0;
    setSessionExpiredHandler(() => {
      calls += 1;
    });
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: "UNAUTHENTICATED", message: "guest", fields: {} },
            requestId: "123e4567-e89b-12d3-a456-426614174000",
          }),
          { status: 401 },
        ),
      ),
    ) as unknown as typeof fetch;
    await expect(
      requestApi({ path: "/api/v1/health", schema: healthResponseSchema, unauthorized: "guest" }),
    ).rejects.toThrow();
    expect(calls).toBe(0);
  });
});
