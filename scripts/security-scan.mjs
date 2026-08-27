import { spawnSync } from "node:child_process";

const gitleaks = spawnSync("gitleaks", ["git", "--redact", "--verbose"], {
  stdio: "inherit",
});
if (!gitleaks.error) process.exit(gitleaks.status ?? 1);
if (gitleaks.error.code !== "ENOENT") {
  console.error(`gitleaks failed to start: ${gitleaks.error.message}`);
  process.exit(1);
}
console.error("gitleaks is required for the release secret scan; install it before running audit");
process.exit(1);
