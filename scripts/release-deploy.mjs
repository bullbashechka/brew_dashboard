import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

import { assertCleanWorktree, assertReleaseConfig, readReleaseConfig } from "./release-config.mjs";

const confirmation = process.argv.slice(2);
const provisionSecret = confirmation.includes("--provision-auth-secret");
const expected = ["--confirm-production", "production"];
if (
  confirmation.filter((argument) => argument !== "--provision-auth-secret").join("\u0000") !==
  expected.join("\u0000")
) {
  throw new Error(
    "Usage: bun run release:deploy -- --confirm-production production [--provision-auth-secret]",
  );
}

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const inputConfigPath = new URL("../wrangler.jsonc", import.meta.url);
const generatedConfigPath = fileURLToPath(
  new URL("../webapp/dist/brew_dashboard/wrangler.json", import.meta.url),
);
const config = readReleaseConfig(inputConfigPath);

const run = (argumentsList) => {
  const result = spawnSync("bun", argumentsList, {
    cwd: repositoryRoot,
    env: { ...process.env, WRANGLER_WRITE_LOGS: "false" },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

assertCleanWorktree();
assertReleaseConfig(config);
run(["run", "build"]);

let secretDirectory;
try {
  const deployArguments = [
    "run",
    "--cwd",
    "webapp",
    "wrangler",
    "deploy",
    "--strict",
    "--config",
    generatedConfigPath,
  ];
  if (provisionSecret) {
    secretDirectory = mkdtempSync(join(tmpdir(), "brew-dashboard-release-"));
    const secretPath = join(secretDirectory, "worker-secrets.json");
    writeFileSync(
      secretPath,
      `${JSON.stringify({ BETTER_AUTH_SECRET: randomBytes(48).toString("base64url") })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    deployArguments.push("--secrets-file", secretPath);
  }
  run(deployArguments);
} finally {
  if (secretDirectory) rmSync(secretDirectory, { force: true, recursive: true });
}

// The command intentionally only checks names. Wrangler never returns secret values.
execFileSync(
  "bun",
  [
    "run",
    "--cwd",
    "webapp",
    "wrangler",
    "secret",
    "list",
    "--config",
    generatedConfigPath,
    "--format",
    "pretty",
  ],
  { cwd: repositoryRoot, env: { ...process.env, WRANGLER_WRITE_LOGS: "false" }, stdio: "inherit" },
);
