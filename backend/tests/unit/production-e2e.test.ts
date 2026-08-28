import { describe, expect, test } from "bun:test";

import {
  parseProductionBaseUrl,
  parseProductionE2eLogin,
} from "../../scripts/production-e2e-guard.ts";

describe("production E2E safety guard", () => {
  test("accepts only the configured Worker origin", () => {
    expect(parseProductionBaseUrl("https://brew-dashboard.example.workers.dev")).toBe(
      "https://brew-dashboard.example.workers.dev",
    );
    expect(() => parseProductionBaseUrl("http://brew-dashboard.example.workers.dev")).toThrow();
    expect(() => parseProductionBaseUrl("https://other.example.workers.dev")).toThrow();
    expect(() =>
      parseProductionBaseUrl("https://brew-dashboard.example.workers.dev/app"),
    ).toThrow();
  });

  test("normalizes the selected account without permitting a missing login", () => {
    expect(parseProductionE2eLogin(" Stage13.Acceptance ")).toBe("stage13.acceptance");
    expect(() => parseProductionE2eLogin(undefined)).toThrow();
  });
});
