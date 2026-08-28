import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { assertCleanWorktree, assertReleaseConfig, readReleaseConfig } from "./release-config.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const configPath = new URL("../wrangler.jsonc", import.meta.url);
const generatedConfigPath = new URL("../webapp/dist/brew_dashboard/wrangler.json", import.meta.url);

const run = (command, argumentsList) => {
  const result = spawnSync(command, argumentsList, {
    cwd: repositoryRoot,
    env: { ...process.env, WRANGLER_WRITE_LOGS: "false" },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

assertCleanWorktree();
assertReleaseConfig(readReleaseConfig(configPath));
run("bun", ["run", "validate:stage12"]);
run("bun", ["run", "build"]);
run("bun", [
  "run",
  "--cwd",
  "webapp",
  "wrangler",
  "deploy",
  "--dry-run",
  "--config",
  fileURLToPath(generatedConfigPath),
]);
