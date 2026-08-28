import { describe, expect, test } from "bun:test";

import {
  assertProductionBaseUrl,
  assertReleaseConfig,
  readReleaseConfig,
} from "./release-config.mjs";

const config = readReleaseConfig(new URL("../wrangler.jsonc", import.meta.url));

describe("production release config", () => {
  test("keeps the single-worker deployment topology", () => {
    expect(() => assertReleaseConfig(config, { requireBaseUrl: false })).not.toThrow();
    expect(config.workers_dev).toBe(true);
    expect(config.preview_urls).toBe(false);
    expect(config.hyperdrive).toHaveLength(1);
  });

  test("accepts only the exact Worker workers.dev base URL", () => {
    expect(assertProductionBaseUrl("https://brew-dashboard.example.workers.dev")).toBe(
      "https://brew-dashboard.example.workers.dev",
    );
    expect(() => assertProductionBaseUrl("https://example.workers.dev")).toThrow();
    expect(() => assertProductionBaseUrl("http://brew-dashboard.example.workers.dev")).toThrow();
  });
});
