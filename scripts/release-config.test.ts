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
    expect(config.hyperdrive).toHaveLength(2);
    expect(config.hyperdrive.map((entry) => entry.binding).sort()).toEqual([
      "APP_HYPERDRIVE",
      "AUTH_HYPERDRIVE",
    ]);
    expect(config.vars.RUNTIME_ROLE_SPLIT_STAGE).toBe("A");
    expect(config.durable_objects.bindings[0].name).toBe("RATE_LIMIT_ACTOR");
  });

  test("requires distinct bindings before the final deploy stage", () => {
    expect(() =>
      assertReleaseConfig(config, { requireBaseUrl: false, requireFinalRuntimeSplit: true }),
    ).toThrow("runtime-role split stage C");

    const stageB = {
      ...config,
      vars: { ...config.vars, RUNTIME_ROLE_SPLIT_STAGE: "B" },
      hyperdrive: config.hyperdrive.map((entry, index) => ({
        ...entry,
        id: `${index ? "b" : "a"}`.repeat(32),
      })),
    };
    expect(() => assertReleaseConfig(stageB, { requireBaseUrl: false })).not.toThrow();
    expect(() =>
      assertReleaseConfig(
        {
          ...stageB,
          hyperdrive: stageB.hyperdrive.map((entry) => ({ ...entry, id: "a".repeat(32) })),
        },
        { requireBaseUrl: false },
      ),
    ).toThrow("distinct Hyperdrive IDs");
  });

  test("accepts only the exact Worker workers.dev base URL", () => {
    expect(assertProductionBaseUrl("https://brew-dashboard.bullbashechka.workers.dev")).toBe(
      "https://brew-dashboard.bullbashechka.workers.dev",
    );
    expect(() => assertProductionBaseUrl("https://example.workers.dev")).toThrow();
    expect(() =>
      assertProductionBaseUrl("http://brew-dashboard.bullbashechka.workers.dev"),
    ).toThrow();
  });
});
