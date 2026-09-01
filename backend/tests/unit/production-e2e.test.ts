import { describe, expect, test } from "bun:test";

import {
  assertProductionHealth,
  parseProductionBaseUrl,
  parseProductionE2eLogin,
} from "../../scripts/production-e2e-guard.ts";
import { createChildEnvironment } from "../../scripts/child-environment.ts";

describe("production E2E safety guard", () => {
  test("accepts only the configured Worker origin", () => {
    expect(parseProductionBaseUrl("https://brew-dashboard.bullbashechka.workers.dev")).toBe(
      "https://brew-dashboard.bullbashechka.workers.dev",
    );
    expect(() =>
      parseProductionBaseUrl("http://brew-dashboard.bullbashechka.workers.dev"),
    ).toThrow();
    expect(() => parseProductionBaseUrl("https://other.bullbashechka.workers.dev")).toThrow();
    expect(() =>
      parseProductionBaseUrl("https://brew-dashboard.bullbashechka.workers.dev/app"),
    ).toThrow();
  });

  test("normalizes the selected account without permitting a missing login", () => {
    expect(parseProductionE2eLogin(" Stage13.Acceptance ")).toBe("stage13.acceptance");
    expect(() => parseProductionE2eLogin(undefined)).toThrow();
  });

  test("checks the exact Worker health contract before accepting credentials", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: { status: "ok" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    try {
      await expect(
        assertProductionHealth("https://brew-dashboard.bullbashechka.workers.dev"),
      ).resolves.toBeInstanceOf(Response);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("passes only allowlisted process variables and explicit child credentials", () => {
    const environment = createChildEnvironment(
      {
        PATH: "/usr/bin",
        HOME: "/tmp/test-home",
        LANG: "en_US.UTF-8",
        UNKNOWN_PROVIDER_TOKEN: "must-not-cross-boundary",
        DATABASE_URL: "postgresql://secret",
        SOME_PASSWORD: "must-not-cross-boundary",
      },
      { E2E_PRODUCTION_PASSWORD: "explicit-child-password" },
    );
    expect(environment).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/test-home",
      LANG: "en_US.UTF-8",
      E2E_PRODUCTION_PASSWORD: "explicit-child-password",
    });
    expect(JSON.stringify(environment)).not.toContain("must-not-cross-boundary");
    expect(JSON.stringify(environment)).not.toContain("postgresql://secret");
  });
});
