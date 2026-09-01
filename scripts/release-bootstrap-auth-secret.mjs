import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { assertCleanWorktree, assertReleaseConfig, readReleaseConfig } from "./release-config.mjs";
import { createReleaseChildEnvironment } from "./child-environment.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const configPath = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));
const expectedArguments = ["--confirm-production", "production"];

export const parseSecretList = (output) => {
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed)) throw new Error("Wrangler returned a malformed secret list");
  return parsed.map((entry) => {
    if (!entry || typeof entry !== "object" || typeof entry.name !== "string") {
      throw new Error("Wrangler returned a malformed secret list entry");
    }
    return entry.name;
  });
};

export const assertAuthSecretAbsent = (names) => {
  if (names.includes("BETTER_AUTH_SECRET")) {
    throw new Error(
      "BETTER_AUTH_SECRET already exists; bootstrap never rotates or overwrites authentication keys",
    );
  }
};

const wrangler = (argumentsList, options = {}) =>
  spawnSync("bun", ["run", "--cwd", "webapp", "wrangler", ...argumentsList], {
    cwd: repositoryRoot,
    env: createReleaseChildEnvironment(process.env, { WRANGLER_WRITE_LOGS: "false" }),
    encoding: "utf8",
    ...options,
  });

const main = () => {
  if (process.argv.slice(2).join("\u0000") !== expectedArguments.join("\u0000")) {
    throw new Error(
      "Usage: bun run release:bootstrap-auth-secret -- --confirm-production production",
    );
  }
  assertCleanWorktree();
  assertReleaseConfig(readReleaseConfig(configPath));
  const listed = wrangler(["secret", "list", "--config", configPath, "--format", "json"]);
  if (listed.status !== 0) {
    throw new Error("Could not inspect the existing Worker secrets; bootstrap aborted");
  }
  assertAuthSecretAbsent(parseSecretList(listed.stdout));

  const secretBytes = randomBytes(48);
  try {
    const uploaded = wrangler(
      ["versions", "secret", "put", "BETTER_AUTH_SECRET", "--config", configPath],
      { input: `${secretBytes.toString("base64url")}\n`, stdio: ["pipe", "inherit", "inherit"] },
    );
    if (uploaded.status !== 0) {
      throw new Error("Wrangler could not create the versioned authentication secret");
    }
  } finally {
    secretBytes.fill(0);
  }
};

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === fileURLToPath(new URL(process.argv[1], "file:///"))
) {
  main();
}
