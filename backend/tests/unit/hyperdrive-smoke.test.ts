import { describe, expect, it } from "bun:test";
import {
  buildWranglerCommand,
  createSmokeConfig,
  isValidSmokePayload,
} from "../../scripts/run-hyperdrive-smoke.ts";
import smokeWorker from "../../scripts/hyperdrive-smoke-worker.ts";

const fakeEnvironment = {
  HYPERDRIVE: {} as Hyperdrive,
  HYPERDRIVE_SMOKE_TOKEN: "test-token",
};

describe("Hyperdrive smoke worker", () => {
  it("rejects requests outside the temporary smoke path", async () => {
    const response = await smokeWorker.fetch(
      new Request("http://localhost/not-the-smoke-route"),
      fakeEnvironment,
    );

    expect(response.status).toBe(404);
  });

  it("rejects smoke requests without the one-time token", async () => {
    const response = await smokeWorker.fetch(
      new Request("http://localhost/__hyperdrive_smoke"),
      fakeEnvironment,
    );

    expect(response.status).toBe(401);
  });
});

describe("Hyperdrive smoke payload validation", () => {
  it("accepts only the complete safe success shape", () => {
    expect(
      isValidSmokePayload({
        ok: true,
        queryOk: true,
        runtimeRole: true,
        tenantContextUnset: true,
        tenantRowsHidden: true,
      }),
    ).toBe(true);
    expect(
      isValidSmokePayload({
        ok: true,
        queryOk: true,
        runtimeRole: true,
        tenantContextUnset: true,
        tenantRowsHidden: false,
      }),
    ).toBe(false);
    expect(
      isValidSmokePayload({
        ok: true,
        queryOk: true,
        runtimeRole: true,
        tenantContextUnset: true,
        tenantRowsHidden: true,
        unexpected: "data",
      }),
    ).toBe(false);
  });

  it("builds a minimal remote config without asset routing", () => {
    const config = createSmokeConfig(
      {
        name: "brew-dashboard",
        compatibility_date: "2026-08-21",
        compatibility_flags: ["nodejs_compat"],
        assets: { binding: "ASSETS" },
        hyperdrive: [{ binding: "HYPERDRIVE", id: "config-id" }],
      },
      "../backend/scripts/hyperdrive-smoke-worker.ts",
    );

    expect(config).toEqual({
      name: "brew-dashboard-hyperdrive-smoke",
      main: "../backend/scripts/hyperdrive-smoke-worker.ts",
      compatibility_date: "2026-08-21",
      compatibility_flags: ["nodejs_compat"],
      hyperdrive: [{ binding: "HYPERDRIVE", id: "config-id" }],
    });
    expect("assets" in config).toBe(false);
  });

  it("rejects missing, placeholder and duplicate Hyperdrive bindings", () => {
    const rootConfig = {
      compatibility_date: "2026-08-21",
      hyperdrive: [{ binding: "HYPERDRIVE", id: "config-id" }],
    };

    expect(() => createSmokeConfig({ compatibility_date: "2026-08-21" }, "worker.ts")).toThrow(
      "real HYPERDRIVE binding ID",
    );
    expect(() =>
      createSmokeConfig(
        { ...rootConfig, hyperdrive: [{ binding: "HYPERDRIVE", id: "<replace-me>" }] },
        "worker.ts",
      ),
    ).toThrow("real HYPERDRIVE binding ID");
    expect(() =>
      createSmokeConfig(
        {
          ...rootConfig,
          hyperdrive: [
            { binding: "HYPERDRIVE", id: "config-a" },
            { binding: "HYPERDRIVE", id: "config-b" },
          ],
        },
        "worker.ts",
      ),
    ).toThrow("real HYPERDRIVE binding ID");
  });

  it("builds Wrangler arguments with absolute entry and config paths", () => {
    const command = buildWranglerCommand({
      configPath: "/tmp/smoke.json",
      port: 8787,
      token: "one-time-token",
    });

    expect(command).toContain("--remote");
    expect(command).toContain("/tmp/smoke.json");
    expect(command).toContain("--var");
    expect(command).toContain("HYPERDRIVE_SMOKE_TOKEN:one-time-token");
    expect(command.some((argument) => argument.endsWith("hyperdrive-smoke-worker.ts"))).toBe(true);
  });
});
