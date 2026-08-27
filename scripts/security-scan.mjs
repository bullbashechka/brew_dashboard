import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";

const gitleaks = spawnSync("gitleaks", ["git", "--redact", "--verbose"], {
  stdio: "inherit",
});
if (!gitleaks.error) process.exit(gitleaks.status ?? 1);
if (gitleaks.error.code !== "ENOENT") {
  console.error(`gitleaks failed to start: ${gitleaks.error.message}`);
  process.exit(1);
}

// Keep a dependency-free fallback for local environments where gitleaks is not
// installed. The pre-commit hook remains fail-closed and still requires the
// full scanner before a commit is created.
console.warn("gitleaks is unavailable; running the redacted tracked-and-untracked fallback scan");
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean);
const patterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\b(?:xox[baprs])-[-\w]{20,}\b/u,
  /postgres(?:ql)?:\/\/[^\s/:]+:[^\s@]+@/iu,
];
const findings = [];
const documentationExamples = [".agents/skills/security/rules/"];
for (const file of files) {
  if (documentationExamples.some((prefix) => file.startsWith(prefix))) continue;
  let contents;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = contents.split("\n");
  lines.forEach((line, index) => {
    if (patterns.some((pattern) => pattern.test(line))) findings.push(`${file}:${index + 1}`);
  });
}
if (findings.length) {
  console.error(`Potential secret material found at ${findings.join(", ")}`);
  process.exit(1);
}
console.log(`Fallback secret scan passed (${files.length} tracked/untracked files checked)`);
