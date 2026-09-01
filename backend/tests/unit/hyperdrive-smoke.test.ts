import { describe, expect, it } from "bun:test";
import {
  buildWranglerCommand,
  createSmokeConfig,
  isValidSmokePayload,
  parseSmokeArguments,
  parseLegacyExpectation,
} from "../../scripts/run-hyperdrive-smoke.ts";
import smokeWorker from "../../scripts/hyperdrive-smoke-worker.ts";

const fakeEnvironment = {
  AUTH_HYPERDRIVE: {} as Hyperdrive,
  APP_HYPERDRIVE: {} as Hyperdrive,
  HYPERDRIVE_SMOKE_TOKEN: "test-token",
  EXPECTED_LEGACY_REVOKED: "1" as const,
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
        authRuntimeRole: true,
        authRuntimeRoleSafe: true,
        authRuntimeGrantsValid: true,
        runtimeRole: true,
        runtimeRoleSafe: true,
        runtimeGrantsValid: true,
        tenantContextUnset: true,
        tenantRowsHidden: true,
        tenantTablesRlsEnabled: true,
        appUsersRlsEnabled: true,
        appUsersPolicyPresent: true,
        runtimeOwnsNoTenantTables: true,
        tenantPoliciesPresent: true,
        baselineFunctionsGranted: true,
        migrationHeadApplied: true,
        legacyRuntimeRevoked: true,
        legacyRuntimeActive: false,
      }),
    ).toBe(true);
    expect(
      isValidSmokePayload({
        ok: true,
        queryOk: true,
        authRuntimeRole: true,
        authRuntimeRoleSafe: true,
        authRuntimeGrantsValid: true,
        runtimeRole: true,
        runtimeRoleSafe: true,
        runtimeGrantsValid: true,
        tenantContextUnset: true,
        tenantRowsHidden: false,
        tenantTablesRlsEnabled: true,
        appUsersRlsEnabled: true,
        appUsersPolicyPresent: true,
        runtimeOwnsNoTenantTables: true,
        tenantPoliciesPresent: true,
        baselineFunctionsGranted: true,
        migrationHeadApplied: true,
        legacyRuntimeRevoked: true,
        legacyRuntimeActive: false,
      }),
    ).toBe(false);
    expect(
      isValidSmokePayload({
        ok: true,
        queryOk: true,
        authRuntimeRole: true,
        authRuntimeRoleSafe: true,
        authRuntimeGrantsValid: true,
        runtimeRole: true,
        runtimeRoleSafe: true,
        runtimeGrantsValid: true,
        tenantContextUnset: true,
        tenantRowsHidden: true,
        tenantTablesRlsEnabled: true,
        appUsersRlsEnabled: true,
        appUsersPolicyPresent: true,
        runtimeOwnsNoTenantTables: true,
        tenantPoliciesPresent: true,
        baselineFunctionsGranted: true,
        migrationHeadApplied: true,
        legacyRuntimeRevoked: true,
        legacyRuntimeActive: false,
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
        hyperdrive: [
          { binding: "AUTH_HYPERDRIVE", id: "a".repeat(32) },
          { binding: "APP_HYPERDRIVE", id: "b".repeat(32) },
        ],
      },
      "../backend/scripts/hyperdrive-smoke-worker.ts",
    );

    expect(config).toEqual({
      name: "brew-dashboard-hyperdrive-smoke",
      main: "../backend/scripts/hyperdrive-smoke-worker.ts",
      compatibility_date: "2026-08-21",
      compatibility_flags: ["nodejs_compat"],
      hyperdrive: [
        { binding: "AUTH_HYPERDRIVE", id: "a".repeat(32) },
        { binding: "APP_HYPERDRIVE", id: "b".repeat(32) },
      ],
    });
    expect("assets" in config).toBe(false);
  });

  it("requires an explicit active/revoked legacy expectation", () => {
    expect(parseLegacyExpectation([])).toBe(true);
    expect(parseLegacyExpectation(["--expect-legacy", "active"])).toBe(false);
    expect(parseLegacyExpectation(["--expect-legacy", "revoked"])).toBe(true);
    expect(() => parseLegacyExpectation(["--expect-legacy", "maybe"])).toThrow();
    expect(
      parseSmokeArguments(["--config", "/tmp/release.json", "--expect-legacy", "active"]),
    ).toEqual({
      configPath: "/tmp/release.json",
      expectedLegacyRevoked: false,
    });
    expect(() => parseSmokeArguments(["--config", "relative.json"])).toThrow();
  });

  it("rejects missing, placeholder and duplicate Hyperdrive bindings", () => {
    const rootConfig = {
      compatibility_date: "2026-08-21",
      hyperdrive: [
        { binding: "AUTH_HYPERDRIVE", id: "a".repeat(32) },
        { binding: "APP_HYPERDRIVE", id: "b".repeat(32) },
      ],
    };

    expect(() => createSmokeConfig({ compatibility_date: "2026-08-21" }, "worker.ts")).toThrow(
      "Real AUTH_HYPERDRIVE and APP_HYPERDRIVE binding IDs",
    );
    expect(() =>
      createSmokeConfig(
        {
          ...rootConfig,
          hyperdrive: [
            { binding: "AUTH_HYPERDRIVE", id: "<replace-me>" },
            { binding: "APP_HYPERDRIVE", id: "b".repeat(32) },
          ],
        },
        "worker.ts",
      ),
    ).toThrow("real AUTH_HYPERDRIVE binding ID");
    expect(() =>
      createSmokeConfig(
        {
          ...rootConfig,
          hyperdrive: [
            { binding: "AUTH_HYPERDRIVE", id: "a".repeat(32) },
            { binding: "APP_HYPERDRIVE", id: "a".repeat(32) },
          ],
        },
        "worker.ts",
      ),
    ).toThrow("distinct configuration IDs");
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
