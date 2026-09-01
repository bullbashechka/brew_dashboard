import { describe, expect, it, beforeEach } from "bun:test";

import {
  AUTHENTICATED_MUTATION_MAX_REQUESTS,
  AUTHENTICATED_READ_MAX_REQUESTS,
  DEMO_RESET_MAX_REQUESTS,
  LOGIN_IP_MAX_ATTEMPTS,
  consumeAuthenticatedRequestRateLimit,
  consumeLoginIpRateLimitDistributed,
  consumeLoginIpRateLimit,
  loginAccountRateLimitKey,
} from "../../src/auth/rate-limit.ts";
import {
  __test as memoryRateLimitTest,
  consumeMemoryFixedWindow,
  trustedClientIp,
} from "../../src/http/rate-limit.ts";
import { RateLimitActor, __test as durableRateLimitTest } from "../../src/http/rate-limit-actor.ts";

const secret = "stage-security-test-secret-".padEnd(32, "x");

describe("in-memory request rate limits", () => {
  beforeEach(() => memoryRateLimitTest.clear());

  it("bounds login spray attempts by trusted IP and isolates invalid IPs", () => {
    for (let attempt = 0; attempt < LOGIN_IP_MAX_ATTEMPTS; attempt += 1) {
      expect(consumeLoginIpRateLimit(secret, "198.51.100.10").allowed).toBe(true);
    }
    const blocked = consumeLoginIpRateLimit(secret, "198.51.100.10");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(consumeLoginIpRateLimit(secret, "198.51.100.11").allowed).toBe(true);
    expect(trustedClientIp("not-an-ip")).toBe("unknown");
    expect(trustedClientIp(undefined)).toBe("unknown");
  });

  it("uses independent account limits and excludes events from the memory limiter", () => {
    for (let attempt = 0; attempt < AUTHENTICATED_READ_MAX_REQUESTS; attempt += 1) {
      expect(
        consumeAuthenticatedRequestRateLimit(secret, "user-a", "GET", "/api/v1/overview")?.allowed,
      ).toBe(true);
    }
    expect(
      consumeAuthenticatedRequestRateLimit(secret, "user-a", "GET", "/api/v1/overview")?.allowed,
    ).toBe(false);
    expect(
      consumeAuthenticatedRequestRateLimit(secret, "user-b", "GET", "/api/v1/overview")?.allowed,
    ).toBe(true);

    for (let attempt = 0; attempt < AUTHENTICATED_MUTATION_MAX_REQUESTS; attempt += 1) {
      expect(
        consumeAuthenticatedRequestRateLimit(secret, "user-a", "PATCH", "/api/v1/products/id/price")
          ?.allowed,
      ).toBe(true);
    }
    expect(
      consumeAuthenticatedRequestRateLimit(secret, "user-a", "PATCH", "/api/v1/products/id/price")
        ?.allowed,
    ).toBe(false);
    expect(
      consumeAuthenticatedRequestRateLimit(secret, "user-a", "POST", "/api/v1/events"),
    ).toBeNull();
  });

  it("applies a dedicated reset quota and resets a fixed window at its boundary", () => {
    for (let attempt = 0; attempt < DEMO_RESET_MAX_REQUESTS; attempt += 1) {
      expect(
        consumeAuthenticatedRequestRateLimit(secret, "user-a", "POST", "/api/v1/demo/reset")
          ?.allowed,
      ).toBe(true);
    }
    expect(
      consumeAuthenticatedRequestRateLimit(secret, "user-a", "POST", "/api/v1/demo/reset")?.allowed,
    ).toBe(false);

    const key = "boundary";
    expect(consumeMemoryFixedWindow({ key, max: 1, windowSeconds: 60, nowMs: 1_000 }).allowed).toBe(
      true,
    );
    expect(
      consumeMemoryFixedWindow({ key, max: 1, windowSeconds: 60, nowMs: 61_000 }).allowed,
    ).toBe(true);
  });

  it("derives stable HMAC account keys without retaining raw login values", () => {
    const key = loginAccountRateLimitKey(secret, "demo-user");
    expect(key).toStartWith("brew-dashboard:login-account:");
    expect(key).not.toContain("demo-user");
    expect(key).toBe(loginAccountRateLimitKey(secret, "demo-user"));
  });

  it("fails closed when a production limiter binding is missing", async () => {
    const mfaProduction = await consumeLoginIpRateLimitDistributed(
      { MFA_REQUIRED: "1" },
      secret,
      "198.51.100.12",
    );
    expect(mfaProduction.status).toBe("unavailable");

    const splitProduction = await consumeLoginIpRateLimitDistributed(
      { RUNTIME_ROLE_SPLIT_STAGE: "C", MFA_REQUIRED: "0" },
      secret,
      "198.51.100.13",
    );
    expect(splitProduction.status).toBe("unavailable");
  });

  it("serializes distributed buckets and rejects unbounded actor inputs", async () => {
    const values = new Map<string, unknown>();
    const state = {
      storage: {
        get: async (key: string) => values.get(key),
        put: async (key: string, value: unknown) => void values.set(key, value),
        delete: async (key: string) => values.delete(key),
        list: async ({ prefix, limit }: { prefix?: string; limit?: number }) =>
          new Map(
            [...values.entries()]
              .filter(([key]) => !prefix || key.startsWith(prefix))
              .slice(0, limit ?? Number.POSITIVE_INFINITY),
          ),
      },
      blockConcurrencyWhile: async <T>(callback: () => Promise<T>) => callback(),
    } as unknown as DurableObjectState;
    const actor = new RateLimitActor(state, {});
    const request = () =>
      actor.fetch(
        new Request("https://rate-limit-actor/consume", {
          method: "POST",
          body: JSON.stringify({ key: "bucket-key", windowSeconds: 60, max: 2, nowMs: 1_000 }),
        }),
      );
    expect(((await (await request()).json()) as { allowed: boolean }).allowed).toBe(true);
    expect(((await (await request()).json()) as { allowed: boolean }).allowed).toBe(true);
    const blocked = await request();
    expect(blocked.status).toBe(200);
    expect(((await blocked.json()) as { allowed: boolean }).allowed).toBe(false);
    expect(
      durableRateLimitTest.validConsumeRequest({
        key: "x",
        windowSeconds: 8 * 24 * 60 * 60,
        max: 1,
      }),
    ).toBe(false);
    expect(
      durableRateLimitTest.validConsumeRequest({ key: "x", windowSeconds: 60, max: 100_001 }),
    ).toBe(false);
    expect(durableRateLimitTest.actorNameFor(secret, "x")).toStartWith("rate-limit-shard-");
  });
});
