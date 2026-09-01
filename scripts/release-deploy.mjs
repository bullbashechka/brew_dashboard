import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertCleanWorktree, assertReleaseConfig, readReleaseConfig } from "./release-config.mjs";
import { createReleaseChildEnvironment } from "./child-environment.mjs";
import { parseSecretList } from "./release-bootstrap-auth-secret.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const inputConfigPath = new URL("../wrangler.jsonc", import.meta.url);
const generatedConfigPath = fileURLToPath(
  new URL("../webapp/dist/brew_dashboard/wrangler.json", import.meta.url),
);

export const releaseDeploymentCommands = (configPath = generatedConfigPath, runtimeStage = "C") => [
  ["run", "release:verify"],
  [
    "run",
    "--cwd",
    "webapp",
    "wrangler",
    "secret",
    "list",
    "--config",
    configPath,
    "--format",
    "json",
  ],
  runtimeStage === "B"
    ? ["run", "db:smoke:hyperdrive", "--", "--config", configPath, "--expect-legacy", "active"]
    : ["run", "db:smoke:hyperdrive", "--", "--config", configPath],
  ["run", "--cwd", "webapp", "wrangler", "deploy", "--strict", "--config", configPath],
];

export const assertAuthSecretPresent = (output) => {
  if (!parseSecretList(output).includes("BETTER_AUTH_SECRET")) {
    throw new Error("BETTER_AUTH_SECRET is missing; release aborted before smoke and deploy");
  }
};

export const executeReleaseDeployment = ({
  config,
  configPath = generatedConfigPath,
  expectedStage = "C",
  assertClean = assertCleanWorktree,
  assertConfig = assertReleaseConfig,
  run,
}) => {
  assertClean();
  assertConfig(config, { requireFinalRuntimeSplit: expectedStage === "C" });
  if (config.vars?.RUNTIME_ROLE_SPLIT_STAGE !== expectedStage) {
    throw new Error(`Release command requires runtime-role split stage ${expectedStage}`);
  }
  for (const command of releaseDeploymentCommands(configPath, expectedStage)) {
    const result = run(command);
    if (command.includes("secret") && command.includes("list")) {
      assertAuthSecretPresent(result?.stdout ?? "");
    }
  }
};

export const runReleaseDeploymentCli = (expectedStage = "C") => {
  const confirmation = process.argv.slice(2);
  const expected = ["--confirm-production", "production"];
  if (confirmation.join("\u0000") !== expected.join("\u0000")) {
    throw new Error("Usage: bun run release:deploy -- --confirm-production production");
  }

  const config = readReleaseConfig(inputConfigPath);
  executeReleaseDeployment({
    config,
    expectedStage,
    run(argumentsList) {
      const capturesSecretList = argumentsList.includes("secret") && argumentsList.includes("list");
      const result = spawnSync("bun", argumentsList, {
        cwd: repositoryRoot,
        env: createReleaseChildEnvironment(process.env, { WRANGLER_WRITE_LOGS: "false" }),
        ...(capturesSecretList ? { encoding: "utf8" } : { stdio: "inherit" }),
      });
      if (result.status !== 0) {
        throw new Error(
          `Release command failed before deploy completion: ${argumentsList.join(" ")}`,
        );
      }
      return result;
    },
  });
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runReleaseDeploymentCli("C");
}
