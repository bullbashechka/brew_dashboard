import { describe, expect, test } from "bun:test";

import {
  assertAuthSecretPresent,
  executeReleaseDeployment,
  releaseDeploymentCommands,
} from "./release-deploy.mjs";

describe("Stage C release deployment gate", () => {
  test("places live Hyperdrive verification immediately before Worker deploy", () => {
    const commands = releaseDeploymentCommands("/tmp/generated-wrangler.json", "C");
    expect(commands.slice(0, 4).map((command) => command.slice(0, 2))).toEqual([
      ["run", "release:verify"],
      ["run", "--cwd"],
      ["run", "db:smoke:hyperdrive"],
      ["run", "--cwd"],
    ]);
    expect(commands[3]).toContain("deploy");
    expect(commands.flat()).not.toContain("--provision-auth-secret");
  });

  test("does not invoke deploy when smoke is unavailable or fails", () => {
    const calls: string[][] = [];
    expect(() =>
      executeReleaseDeployment({
        config: { vars: { RUNTIME_ROLE_SPLIT_STAGE: "C" } },
        assertClean: () => undefined,
        assertConfig: () => undefined,
        run(command: string[]) {
          calls.push(command);
          if (command.includes("db:smoke:hyperdrive")) throw new Error("smoke unavailable");
          return command.includes("secret")
            ? { stdout: '[{"name":"BETTER_AUTH_SECRET"}]' }
            : undefined;
        },
      }),
    ).toThrow("smoke unavailable");
    expect(calls).toEqual([
      ["run", "release:verify"],
      expect.arrayContaining(["secret", "list"]),
      ["run", "db:smoke:hyperdrive", "--", "--config", expect.any(String)],
    ]);
    expect(calls.some((command) => command.includes("deploy"))).toBe(false);
  });

  test("blocks smoke and deploy when the authentication secret is missing", () => {
    const calls: string[][] = [];
    expect(() =>
      executeReleaseDeployment({
        config: { vars: { RUNTIME_ROLE_SPLIT_STAGE: "C" } },
        assertClean: () => undefined,
        assertConfig: () => undefined,
        run(command: string[]) {
          calls.push(command);
          return command.includes("secret") ? { stdout: '[{"name":"OTHER_SECRET"}]' } : undefined;
        },
      }),
    ).toThrow("BETTER_AUTH_SECRET is missing");
    expect(calls.some((command) => command.includes("db:smoke:hyperdrive"))).toBe(false);
    expect(calls.some((command) => command.includes("deploy"))).toBe(false);
  });

  test("rejects malformed Wrangler output", () => {
    expect(() => assertAuthSecretPresent("not-json")).toThrow();
  });

  test("keeps legacy active for the prerequisite Stage B deploy", () => {
    const commands = releaseDeploymentCommands("/tmp/generated-wrangler.json", "B");
    expect(commands[2]).toEqual([
      "run",
      "db:smoke:hyperdrive",
      "--",
      "--config",
      "/tmp/generated-wrangler.json",
      "--expect-legacy",
      "active",
    ]);
    expect(() =>
      executeReleaseDeployment({
        config: { vars: { RUNTIME_ROLE_SPLIT_STAGE: "C" } },
        expectedStage: "B",
        assertClean: () => undefined,
        assertConfig: () => undefined,
        run: () => undefined,
      }),
    ).toThrow("stage B");
  });
});
